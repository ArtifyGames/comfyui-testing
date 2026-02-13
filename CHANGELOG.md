# Changelog

## 0.1.1 - 2026-02-13

- Removed `Select Inputs (Artify)` (`ArtifySelectInputs`).
- Updated `XYZ Plot (Artify)` so `input_x`, `input_y`, and `input_z` are direct dropdown selects from graph widgets.
- Removed `archive_existing` input from `XYZ Plot (Artify)` and made archiving always-on.
- Reordered `XYZ Plot (Artify)` inputs so `value_x`, `value_y`, and `value_z` are grouped at the bottom.
- Added advanced `output_folder_name` token preset support for `XYZ Plot (Artify)` including `%date:...%` and `%inputx/y/z_*%` replacements with automatic Z-suffix cleanup when Z is unused.

## 0.1.0 - 2026-02-13

- Initial publish-ready release for `comfyui-testing`.
- Added `Select Inputs (Artify)` (`ArtifySelectInputs`).
- Added `XYZ Plot (Artify)` (`ArtifyXYZPlot`) for queued X/Y/Z sweeps and `result.json` output.
- Added `XYZ Viewer (Artify)` (`ArtifyXYZViewer`) with in-node HTML preview:
  - labeled X/Y matrix rendering when `result.json` exists
  - flat image-grid fallback when loading plain image folders
- Added server routes for listing folders, loading `result.json`, and listing image files for folder-based browsing.
