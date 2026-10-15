#!/usr/bin/env python3
"""Report a paired 100 Nutrition5k + 30 consented meal photo benchmark."""
import csv
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path

NUMBERS = ('known_calories', 'predicted_calories', 'known_grams', 'predicted_grams',
           'known_protein_g', 'predicted_protein_g', 'known_carbs_g', 'predicted_carbs_g',
           'known_fat_g', 'predicted_fat_g')

def foods(value):
    return {food.strip().casefold() for food in value.split('|') if food.strip()}

def percentile(values, p):
    values = sorted(values)
    pos = (len(values) - 1) * p
    low = math.floor(pos)
    return values[low] + (values[math.ceil(pos)] - values[low]) * (pos - low)

def summary(rows):
    errors = [abs(r['predicted_calories'] - r['known_calories']) for r in rows]
    relative = [100 * e / r['known_calories'] for e, r in zip(errors, rows) if r['known_calories'] > 0]
    known = sum(len(r['_known_foods']) for r in rows)
    detected = sum(len(r['_known_foods'] & r['_detected_foods']) for r in rows)
    return (f"{len(rows)} | {statistics.median(errors):.0f} kcal | {percentile(errors, .9):.0f} kcal | "
            f"{statistics.median(relative):.1f}% | {percentile(relative, .9):.1f}% | "
            f"{detected / known:.1%} | {sum(r['corrected'] == 'yes' for r in rows) / len(rows):.1%}")

def main(path):
    with path.open(newline='') as file:
        reader = csv.DictReader(file)
        required = {'plate_id', 'source', 'meal_type', 'image_setting', 'image_path', 'provider', 'model', 'known_foods', 'detected_foods', 'corrected', *NUMBERS}
        if not required.issubset(reader.fieldnames or []):
            raise SystemExit(f'Missing columns: {sorted(required - set(reader.fieldnames or []))}')
        rows = list(reader)
    if not rows:
        raise SystemExit('No measurements yet. Do not publish a quality claim.')
    for row in rows:
        if not all(row.get(key) for key in ('plate_id', 'image_path', 'provider', 'model')) or row['source'] not in ('nutrition5k', 'pilot') or row['meal_type'] not in ('breakfast', 'lunch', 'dinner', 'snack') or row['corrected'] not in ('yes', 'no'):
            raise SystemExit(f"Incomplete category or correction annotation: {row['plate_id']}")
        for key in NUMBERS:
            row[key] = float(row[key])
            if not math.isfinite(row[key]) or row[key] < 0:
                raise SystemExit(f"Invalid {key} for {row['plate_id']}")
        if row['known_calories'] <= 0 or row['image_setting'] not in ('current', 'higher_resolution'):
            raise SystemExit(f"Invalid reference calories or image setting for {row['plate_id']}")
        row['_known_foods'] = foods(row['known_foods'])
        row['_detected_foods'] = foods(row['detected_foods'])
        if not row['_known_foods']:
            raise SystemExit(f"No annotated foods for {row['plate_id']}")
    by_plate = defaultdict(list)
    for row in rows:
        by_plate[(row['source'], row['plate_id'])].append(row)
    sources = {source: sum(key[0] == source for key in by_plate) for source in ('nutrition5k', 'pilot')}
    if sources != {'nutrition5k': 100, 'pilot': 30} or len(rows) != 260 or any(sorted(r['image_setting'] for r in pair) != ['current', 'higher_resolution'] for pair in by_plate.values()):
        raise SystemExit(f'Expected 100 official test plates and 30 consented pilot meals at two settings each; got {sources} and {len(rows)} rows.')
    for key, pair in by_plate.items():
        reference = pair[0]
        stable = ('meal_type', 'image_path', 'provider', 'model', 'known_foods', *(n for n in NUMBERS if n.startswith('known_')))
        if any(any(row[field] != reference[field] for field in stable) for row in pair[1:]):
            raise SystemExit(f'Paired rows disagree on reference data or provider/model for {key}.')
    print('# FitCoach photo quality report')
    print('\nAbsolute calorie error uses kcal; percentage error divides by known kcal. Detection rate counts annotated foods found. Correction rate counts meals edited after model output.')
    print('\n| Source | Meal | Setting | Provider | Model | N | Median error | P90 error | Median % | P90 % | Food detection | Correction |')
    print('|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|')
    groups = defaultdict(list)
    for row in rows:
        groups[(row['source'], row['meal_type'], row['image_setting'], row['provider'], row['model'])].append(row)
    for key, group in sorted(groups.items()):
        print('| ' + ' | '.join(key) + ' | ' + summary(group) + ' |')
    print('\n## Overall by image setting')
    print('\n| Setting | N | Median error | P90 error | Median % | P90 % | Food detection | Correction |')
    print('|---|---:|---:|---:|---:|---:|---:|---:|')
    for setting in sorted({r['image_setting'] for r in rows}):
        print(f"| {setting} | {summary([r for r in rows if r['image_setting'] == setting])} |")
    missed = defaultdict(int)
    for row in rows:
        for food in row['_known_foods'] - row['_detected_foods']:
            missed[(row['image_setting'], food)] += 1
    print('\n## Missed visible foods')
    print('\n| Setting | Food | Misses |')
    print('|---|---|---:|')
    for (setting, food), count in sorted(missed.items(), key=lambda item: (-item[1], item[0])):
        print(f'| {setting} | {food} | {count} |')

if __name__ == '__main__':
    main(Path(sys.argv[1] if len(sys.argv) > 1 else 'pilot/photo_benchmark.csv'))
