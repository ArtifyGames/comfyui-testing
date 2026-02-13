# Changelog

## 0.1.0 - 2026-02-13

- Initial publish-ready release for `comfyui-testing`.
- Added `Select Inputs (Artify)` (`ArtifySelectInputs`).
- Added `XYZ Plot (Artify)` (`ArtifyXYZPlot`) for queued X/Y/Z sweeps and `result.json` output.
- Added `XYZ Viewer (Artify)` (`ArtifyXYZViewer`) with in-node HTML preview:
  - labeled X/Y matrix rendering when `result.json` exists
  - flat image-grid fallback when loading plain image folders
- Added server routes for listing folders, loading `result.json`, and listing image files for folder-based browsing.
