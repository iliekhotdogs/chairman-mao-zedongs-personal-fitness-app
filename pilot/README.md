# Photo pilot measurement

Do not invite testers until this report contains measured results and the safety and deletion checks pass.

1. Check the account's current Groq model and free limits. Keep the existing gateway and record its returned model per row.
2. Select 100 plate IDs from Nutrition5k's **official test split** before looking at predictions. Download only each selected plate's image and metadata. Record the selection and image paths in a private manifest. Nutrition5k is CC BY 4.0 and cafeteria biased.
3. Collect 30 separately photographed, weighed meals with written consent for provider processing. Keep these images private. Record meal type, known grams, macros, calories, and foods present.
4. Run every image twice through the same signed-in gateway, using the current 768 px/180 KB client setting and one higher-resolution setting. Record the provider, returned model, predicted values and food detections. Have a reviewer correct each estimate and mark `corrected=yes` where needed.
5. Fill [photo_benchmark.csv](photo_benchmark.csv) with one row per photo and setting, then run `python3 pilot/report.py pilot/photo_benchmark.csv > pilot/photo_quality_report.md`. The script requires all 260 paired rows and reports each meal type and setting. Review missed foods and portion errors before choosing a setting.

Use the [official Nutrition5k dataset](https://github.com/google-research-datasets/Nutrition5k) and its split/metadata files; do not substitute training plates. The pilot's 30 photos are not public test data. Record refused, timed-out, or unparseable responses with zero predicted values, zero detected foods, and `corrected=yes`; include them in the benchmark rather than silently dropping them.
