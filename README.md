# ComfyUI Testing (Artify)

ComfyUI Testing is a lightweight Artify custom node pack for building and previewing XYZ parameter sweeps.

## Included nodes

- `Select Inputs (Artify)`
  - Node id: `ArtifySelectInputs`
  - Category: `Artify/Testing`
  - Lets you pick graph widget inputs to drive XYZ axes.
- `XYZ Plot (Artify)`
  - Node id: `ArtifyXYZPlot`
  - Category: `Artify/Testing`
  - Queues X/Y/Z parameter sweeps and saves outputs into `output/<folder_name>` with `result.json`.
- `XYZ Viewer (Artify)`
  - Node id: `ArtifyXYZViewer`
  - Category: `Artify/Testing`
  - In-node HTML viewer with:
    - labeled X/Y matrix grid when `result.json` is available
    - simple flat image grid fallback for plain image folders

## Install

### Method 1: ComfyUI `custom_nodes` folder

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/ArtifyGames/comfyui-testing.git
```

Install dependencies (if needed in future):

```bash
python -m pip install -r requirements.txt
```

Restart ComfyUI and refresh the browser page.

## Typical flow

1. Add `Select Inputs (Artify)` and choose the graph inputs for X/Y/Z.
2. Connect those to `XYZ Plot (Artify)`.
3. Connect `XYZ Plot (Artify)` output to `XYZ Viewer (Artify)`.
4. Run the workflow.

## Load existing folders

In `XYZ Viewer (Artify)`:

- Set `source_mode` to `load_folder`.
- Use `Load Folder` to pick a local folder in-browser, or set `folder_name` to load from ComfyUI output.

If the folder contains `result.json`, the viewer renders the labeled matrix.
If not, it renders a simple image grid.

## License

See `LICENSE`.
