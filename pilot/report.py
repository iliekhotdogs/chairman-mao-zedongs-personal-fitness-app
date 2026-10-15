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
           'known_fat_g', 'predicted_fat_g', 'known_food_count', 'detected_food_count')

def percentile(values, p):
    values = sorted(values)
    pos = (len(values) - 1) * p
    low = math.floor(pos)
    return values[low] + (values[math.ceil(pos)] - values[low]) * (pos - low)

def summary(rows):
    errors = [abs(r['predicted_calories'] - r['known_calories']) for r in rows]
    relative = [100 * e / r['known_calories'] for e, r in zip(errors, rows) if r['known_calories'] > 0]
    known = sum(r['known_food_count'] for r in rows)
    detected = sum(r['detected_food_count'] for r in rows)
    return (f"{len(rows)} | {statistics.median(errors):.0f} kcal | {percentile(errors, .9):.0f} kcal | "
            f"{statistics.median(relative):.1f}% | {percentile(relative, .9):.1f}% | "
            f"{detected / known:.1%} | {sum(r['corrected'] == 'yes' for r in rows) / len(rows):.1%}")

def main(path):
    with path.open(newline='') as file:
        rows = list(csv.DictReader(file))
    if not rows:
        raise SystemExit('No measurements yet. Do not publish a quality claim.')
    for row in rows:
        if row['source'] not in ('nutrition5k', 'pilot') or row['meal_type'] not in ('breakfast', 'lunch', 'dinner', 'snack') or row['corrected'] not in ('yes', 'no'):
            raise SystemExit(f"Incomplete category or correction annotation: {row['plate_id']}")
        for key in NUMBERS:
            row[key] = float(row[key])
            if not math.isfinite(row[key]) or row[key] < 0:
                raise SystemExit(f"Invalid {key} for {row['plate_id']}")
        if row['known_calories'] <= 0 or row['image_setting'] not in ('current', 'higher_resolution'):
            raise SystemExit(f"Invalid reference calories or image setting for {row['plate_id']}")
        if row['detected_food_count'] > row['known_food_count'] or not row['known_food_count']:
            raise SystemExit(f"Invalid food detection count for {row['plate_id']}")
    by_plate = defaultdict(set)
    for row in rows:
        by_plate[(row['source'], row['plate_id'])].add(row['image_setting'])
    sources = {source: sum(key[0] == source for key in by_plate) for source in ('nutrition5k', 'pilot')}
    if sources != {'nutrition5k': 100, 'pilot': 30} or any(len(settings) != 2 for settings in by_plate.values()) or len(rows) != 260:
        raise SystemExit(f'Expected 100 official test plates and 30 consented pilot meals at two settings each; got {sources} and {len(rows)} rows.')
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

if __name__ == '__main__':
    main(Path(sys.argv[1] if len(sys.argv) > 1 else 'pilot/photo_benchmark.csv'))
