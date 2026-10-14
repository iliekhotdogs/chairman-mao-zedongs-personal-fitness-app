# Photo pilot measurement

Do not invite testers until this report contains measured results and the safety and deletion checks pass.

1. Check the configured gateway provider, model availability, and account limits. Keep the existing provider and record its returned model per row.
2. Select 100 plate IDs from Nutrition5k's **official test split** before looking at predictions. Download only each selected plate's image and metadata. Record the selection and image paths in a private manifest. Nutrition5k is CC BY 4.0 and cafeteria biased.
3. Collect 30 separately photographed, weighed meals with written consent for provider processing. Keep these images private. Record meal type, known grams, macros, calories, and foods present.
4. Run every image twice through the same signed-in gateway, using the current 768 px/180 KB client setting and one higher-resolution setting. Record the provider, returned model, predicted values and food detections. Have a reviewer correct each estimate and mark `corrected=yes` where needed.
5. Fill [photo_benchmark.csv](photo_benchmark.csv) with one row per photo and setting, then run `python3 pilot/report.py pilot/photo_benchmark.csv > pilot/photo_quality_report.md`. The script requires all 260 paired rows and reports each meal type and setting. Review missed foods and portion errors before choosing a setting.

Keep images and the selection manifest under `pilot/private/`; they are ignored by Git. Use the same `image_path`, provider, model, meal type, and known values in both rows for each plate. In `known_foods`, list the **visible distinct foods** a reviewer can identify, separated by `|` (for example `chicken|rice|broccoli`). In `detected_foods`, use the same names for foods the model identified; extra wrong foods may also be listed. Leave `detected_foods` empty for a failed estimate. The report calculates detection from the intersection of these lists, so unrelated model foods do not count as hits.

After downloading the official `dish_ids/splits/depth_test_ids.txt` and both `metadata/dish_metadata_cafe*.csv` files, generate the fixed selection before viewing predictions:

```sh
python3 pilot/select_plates.py path/to/depth_test_ids.txt path/to/dish_metadata_cafe1.csv path/to/dish_metadata_cafe2.csv
```

The private manifest records a SHA-256 of the split, the selection seed, reference nutrition, each selected image path, and its Google Cloud Storage object. Download just those 100 `rgb.png` objects from the official bucket into the listed paths. Record meal type and visible food components by human review before calling the AI gateway.

Use the [official Nutrition5k dataset](https://github.com/google-research-datasets/Nutrition5k) and its split/metadata files; do not substitute training plates. The pilot's 30 photos are not public test data. Record refused, timed-out, or unparseable responses with zero predicted values, zero detected foods, and `corrected=yes`; include them in the benchmark rather than silently dropping them.
