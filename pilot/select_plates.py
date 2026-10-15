#!/usr/bin/env python3
"""Select 100 Nutrition5k plates from a supplied official overhead test split."""
import argparse
import csv
import hashlib
import math
from pathlib import Path

SEED = 'fitcoach-pilot-v1'

def metadata(paths):
    dishes = {}
    for path in paths:
        with path.open(newline='') as file:
            for row in csv.reader(file):
                if not row or not row[0].startswith('dish_'):
                    continue
                if len(row) < 7:
                    raise SystemExit(f'Incomplete metadata for {row[0]} in {path}')
                values = [float(value) for value in row[1:6]]
                if not all(math.isfinite(value) and value >= 0 for value in values):
                    raise SystemExit(f'Invalid nutrition metadata for {row[0]} in {path}')
                dishes[row[0]] = values
    return dishes

def select(split, meta_paths, output):
    if 'test' not in split.name.lower() or not split.name.endswith('_ids.txt'):
        raise SystemExit('Use an official Nutrition5k test split ID file, such as depth_test_ids.txt.')
    split_bytes = split.read_bytes()
    ids = [line.strip() for line in split_bytes.decode().splitlines() if line.strip()]
    if len(ids) != len(set(ids)) or any(not dish.startswith('dish_') for dish in ids):
        raise SystemExit('Test split contains duplicate or invalid dish IDs.')
    labels = metadata(meta_paths)
    missing = set(ids) - labels.keys()
    if missing:
        raise SystemExit(f'Metadata missing for {len(missing)} test dishes; check that both cafe files are supplied.')
    if len(ids) < 100:
        raise SystemExit(f'Test split contains only {len(ids)} dishes; need at least 100.')
    ordered = sorted(ids, key=lambda dish: hashlib.sha256(f'{SEED}:{dish}'.encode()).digest())[:100]
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('w', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(['plate_id', 'image_path', 'gcs_object', 'known_calories', 'known_grams', 'known_fat_g', 'known_carbs_g', 'known_protein_g', 'split_sha256', 'selection_seed'])
        split_hash = hashlib.sha256(split_bytes).hexdigest()
        for dish in ordered:
            writer.writerow([dish, f'pilot/private/nutrition5k/{dish}.png', f'nutrition5k_dataset/imagery/realsense_overhead/{dish}/rgb.png', *labels[dish], split_hash, SEED])
    print(f'Selected 100 test plates from {split}; manifest: {output}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('split', type=Path, help='Official overhead test split, usually depth_test_ids.txt')
    parser.add_argument('cafe1', type=Path, help='Official dish_metadata_cafe1.csv')
    parser.add_argument('cafe2', type=Path, help='Official dish_metadata_cafe2.csv')
    parser.add_argument('--output', type=Path, default=Path('pilot/private/nutrition5k_selection.csv'))
    args = parser.parse_args()
    select(args.split, (args.cafe1, args.cafe2), args.output)
