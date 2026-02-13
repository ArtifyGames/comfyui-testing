import copy
import functools
import json
import os
import re
import shutil
import time
from typing import Any

import numpy as np
import requests
import torch
from PIL import Image, ImageDraw, ImageOps
from requests.adapters import HTTPAdapter, Retry

import folder_paths
from comfy.cli_args import args
from comfy_api.latest import io

INPUT_REF = io.Custom("INPUT")
XYZ_PLOT_DATA = io.Custom("ARTIFY_XYZ_PLOT")

CATEGORY = "Artify/Testing"
SPLITTER = "::"


def _server_base_url() -> str:
    base = f"http://{args.listen}:{args.port}"
    if ":" in args.listen:
        base = f"http://[{args.listen}]:{args.port}"
    return base


@functools.cache
def _http_client() -> requests.Session:
    session = requests.Session()
    retry = Retry(total=3, backoff_factor=0.1)
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


def _sanitize_folder_name(name: str) -> str:
    clean = (name or "").strip().replace("\\", "/")
    clean = clean.strip("/")
    clean = clean.replace("..", "")
    if not clean:
        clean = "xyz_plot_artify"
    return clean


def _split_values(raw: str) -> list[str]:
    if raw is None:
        return []
    text = raw.strip()
    if not text:
        return []
    # Keep semicolon as the primary separator (matches original xyz_plot behavior),
    # but accept comma-separated values when semicolons are not used.
    if ";" in text:
        parts = text.split(";")
    elif "," in text:
        parts = text.split(",")
    else:
        parts = [text]
    return [v.strip() for v in parts if v.strip()]


def _output_folder_path(folder_name: str) -> str:
    return os.path.join(folder_paths.get_output_directory(), folder_name)


def _image_filename(ix: int, iy: int, iz: int, batch_index: int) -> str:
    if iz >= 0:
        return f"x{ix}_y{iy}_z{iz}_{batch_index}.jpeg"
    return f"x{ix}_y{iy}_{batch_index}.jpeg"


def _preview_src(folder_name: str, filename: str) -> str:
    return f"/view?filename={filename}&type=output&subfolder={folder_name}"


def _parse_input_ref(input_ref: Any) -> dict[str, str] | None:
    if not isinstance(input_ref, str):
        return None

    value = input_ref.strip()
    if not value or value == "none":
        return None

    parts = value.split(SPLITTER, 2)
    if len(parts) != 3:
        return None

    node_id = parts[0]
    if node_id.startswith("#"):
        node_id = node_id[1:]

    return {
        "node_id": node_id,
        "node_title": parts[1],
        "widget_name": parts[2],
    }


def _ensure_prompt_node(prompt: dict[str, Any], node_id: str) -> dict[str, Any]:
    node = prompt.get(str(node_id))
    if node is None:
        node = prompt.get(int(node_id)) if str(node_id).isdigit() else None
    if node is None:
        raise ValueError(f"Node id '{node_id}' does not exist in prompt.")
    return node


def _set_axis_value(prompt: dict[str, Any], axis_ref: dict[str, str], value: str) -> None:
    node = _ensure_prompt_node(prompt, axis_ref["node_id"])
    node_inputs = node.setdefault("inputs", {})
    widget_name = axis_ref["widget_name"]
    if widget_name not in node_inputs:
        raise ValueError(
            f"Widget '{widget_name}' was not found on node #{axis_ref['node_id']} ({axis_ref.get('node_title', 'unknown')})."
        )
    node_inputs[widget_name] = value


def _queue_prompt(
    prompt_data: dict[str, Any],
    partial_execution_targets: list[str] | None = None,
    client_id: str | None = None,
) -> None:
    payload: dict[str, Any] = {"prompt": prompt_data}
    if partial_execution_targets:
        payload["partial_execution_targets"] = partial_execution_targets
    if client_id:
        payload["client_id"] = client_id

    response = _http_client().post(
        f"{_server_base_url()}/prompt",
        json=payload,
        timeout=20,
        proxies={"http": "", "https": ""},
    )
    if response.status_code != 200:
        raise RuntimeError(f"Queueing XYZ prompt failed ({response.status_code}): {response.text}")


def _current_client_id() -> str | None:
    try:
        import server

        prompt_server = getattr(server.PromptServer, "instance", None)
        if prompt_server is None:
            return None
        client_id = getattr(prompt_server, "client_id", None)
        return str(client_id) if client_id else None
    except Exception:
        return None


def _find_viewer_node_ids(prompt: dict[str, Any], plot_node_id: str) -> list[str]:
    viewer_ids: list[str] = []
    for node_id, node_data in prompt.items():
        if not isinstance(node_data, dict):
            continue
        if node_data.get("class_type") != "ArtifyXYZViewer":
            continue

        xyz_input = node_data.get("inputs", {}).get("xyz_plot")
        if isinstance(xyz_input, list) and len(xyz_input) == 2 and str(xyz_input[0]) == str(plot_node_id):
            viewer_ids.append(str(node_id))
    return viewer_ids


def _prepare_viewer_refresh_prompt(
    prompt: dict[str, Any],
    viewer_ids: list[str],
    folder_name: str,
    folder_path: str,
) -> dict[str, Any]:
    new_prompt = copy.deepcopy(prompt)
    plot_data = {
        "folder_name": folder_name,
        "folder_path": folder_path,
        "result_path": os.path.join(folder_path, "result.json"),
    }

    for viewer_id in viewer_ids:
        viewer_node = _ensure_prompt_node(new_prompt, viewer_id)
        inputs = viewer_node.setdefault("inputs", {})
        # Force viewer to read directly from folder metadata.
        inputs["xyz_plot"] = plot_data

    return new_prompt


def _save_images(images: torch.Tensor, output_folder: str, ix: int, iy: int, iz: int) -> None:
    os.makedirs(output_folder, exist_ok=True)

    for batch_index, image_tensor in enumerate(images):
        arr = (255.0 * image_tensor.cpu().numpy()).clip(0, 255).astype(np.uint8)
        pil_image = Image.fromarray(arr).convert("RGB")
        filename = _image_filename(ix, iy, iz, batch_index)
        pil_image.save(os.path.join(output_folder, filename), "JPEG", quality=90)


def _build_result_tree(
    folder_name: str,
    values_x: list[str],
    values_y: list[str],
    values_z: list[str],
    batch_size: int,
) -> list[dict[str, Any]]:
    result = []
    has_z = len(values_z) > 0

    for ix, vx in enumerate(values_x):
        row = []
        for iy, vy in enumerate(values_y):
            cell = []
            if has_z:
                for iz, vz in enumerate(values_z):
                    z_imgs = []
                    for batch_index in range(batch_size):
                        filename = _image_filename(ix, iy, iz, batch_index)
                        z_imgs.append(
                            {
                                "uuid": f"{folder_name}:{ix}:{iy}:{iz}:{batch_index}",
                                "type": "img",
                                "filename": filename,
                                "src": _preview_src(folder_name, filename),
                            }
                        )
                    cell.append({"type": "axis", "value": vz, "children": z_imgs})
            else:
                for batch_index in range(batch_size):
                    filename = _image_filename(ix, iy, -1, batch_index)
                    cell.append(
                        {
                            "uuid": f"{folder_name}:{ix}:{iy}:-1:{batch_index}",
                            "type": "img",
                            "filename": filename,
                            "src": _preview_src(folder_name, filename),
                        }
                    )

            row.append({"type": "axis", "value": vy, "children": cell})

        result.append({"type": "axis", "value": vx, "children": row})

    return result


def _build_annotations(input_x: dict[str, str], input_y: dict[str, str], input_z: dict[str, str] | None) -> list[dict[str, str]]:
    annotations = []
    axis_defs = [("X", input_x), ("Y", input_y), ("Z", input_z)]
    for axis, axis_ref in axis_defs:
        if not axis_ref:
            continue
        annotations.append(
            {
                "axis": axis,
                "key": f"#{axis_ref['node_id']} {axis_ref.get('node_title', '')}".strip(),
                "type": axis_ref["widget_name"],
            }
        )
    return annotations


def _read_result_json(folder_path: str) -> dict[str, Any] | None:
    result_path = os.path.join(folder_path, "result.json")
    if not os.path.exists(result_path):
        return None
    with open(result_path, "r", encoding="utf-8") as file:
        return json.load(file)


def _write_result_json(folder_path: str, payload: dict[str, Any]) -> None:
    os.makedirs(folder_path, exist_ok=True)
    result_path = os.path.join(folder_path, "result.json")
    with open(result_path, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)


def _collect_plot_meta(folder_path: str) -> dict[str, Any]:
    result_json = _read_result_json(folder_path)
    if result_json is None:
        return _infer_plot_meta_from_filenames(folder_path)

    result_tree = result_json.get("result") or []
    values_x = list(result_json.get("values", {}).get("x", []))
    values_y = list(result_json.get("values", {}).get("y", []))
    values_z = list(result_json.get("values", {}).get("z", []))

    if not values_x or not values_y:
        values_x, values_y, values_z, batch_size = _extract_axis_values_from_tree(result_tree)
    else:
        _, _, _, batch_size = _extract_axis_values_from_tree(result_tree)

    z_slots = list(range(len(values_z))) if values_z else [-1]
    return {
        "values_x": values_x,
        "values_y": values_y,
        "values_z": values_z,
        "z_slots": z_slots,
        "batch_size": batch_size,
    }


def _extract_axis_values_from_tree(result_tree: list[dict[str, Any]]) -> tuple[list[str], list[str], list[str], int]:
    values_x = []
    values_y = []
    values_z = []
    batch_size = 1

    if not result_tree:
        return values_x, values_y, values_z, batch_size

    values_x = [str(x.get("value", f"x{ix}")) for ix, x in enumerate(result_tree)]

    first_x_children = result_tree[0].get("children", [])
    values_y = [str(y.get("value", f"y{iy}")) for iy, y in enumerate(first_x_children)]

    if first_x_children:
        first_cell = first_x_children[0].get("children", [])
        if first_cell and isinstance(first_cell[0], dict) and first_cell[0].get("type") == "axis":
            values_z = [str(z.get("value", f"z{iz}")) for iz, z in enumerate(first_cell)]
            first_images = first_cell[0].get("children", []) if first_cell else []
            batch_size = max(1, len(first_images))
        else:
            batch_size = max(1, len(first_cell))

    return values_x, values_y, values_z, batch_size


def _infer_plot_meta_from_filenames(folder_path: str) -> dict[str, Any]:
    pattern = re.compile(r"^x(\d+)_y(\d+)(?:_z(\d+))?_(\d+)\.(?:jpg|jpeg|png|webp)$", re.IGNORECASE)
    x_indices: set[int] = set()
    y_indices: set[int] = set()
    z_indices: set[int] = set()
    batches: set[int] = set()

    for name in os.listdir(folder_path):
        match = pattern.match(name)
        if not match:
            continue
        x_indices.add(int(match.group(1)))
        y_indices.add(int(match.group(2)))
        z_indices.add(int(match.group(3)) if match.group(3) is not None else -1)
        batches.add(int(match.group(4)))

    if not x_indices or not y_indices:
        raise ValueError(f"No XYZ images found in folder: {folder_path}")

    has_z = any(z >= 0 for z in z_indices)
    z_slots = sorted([z for z in z_indices if z >= 0]) if has_z else [-1]

    values_x = [f"x{idx}" for idx in range(max(x_indices) + 1)]
    values_y = [f"y{idx}" for idx in range(max(y_indices) + 1)]
    values_z = [f"z{z}" for z in z_slots] if has_z else []

    return {
        "values_x": values_x,
        "values_y": values_y,
        "values_z": values_z,
        "z_slots": z_slots,
        "batch_size": max(batches) + 1 if batches else 1,
    }


def _load_cell_image(folder_path: str, ix: int, iy: int, z_slot: int, batch_index: int) -> Image.Image | None:
    filename = _image_filename(ix, iy, z_slot, batch_index)
    image_path = os.path.join(folder_path, filename)
    if not os.path.exists(image_path):
        return None
    with Image.open(image_path) as img:
        return img.convert("RGB")


def _render_grid(
    folder_name: str,
    folder_path: str,
    plot_meta: dict[str, Any],
    z_index: int,
    batch_index: int,
    cell_size: int,
    padding: int,
    show_labels: bool,
) -> Image.Image:
    values_x = plot_meta["values_x"]
    values_y = plot_meta["values_y"]
    values_z = plot_meta["values_z"]
    z_slots = plot_meta["z_slots"]
    max_batch = max(1, int(plot_meta["batch_size"]))

    if not values_x or not values_y:
        raise ValueError("No axis values found in this XYZ folder.")

    z_index = max(0, min(z_index, len(z_slots) - 1))
    batch_index = max(0, min(batch_index, max_batch - 1))
    z_slot = z_slots[z_index]

    left_width = 170 if show_labels else padding
    top_height = 64 if show_labels else padding

    cols = len(values_x)
    rows = len(values_y)

    canvas_w = left_width + padding + cols * (cell_size + padding)
    canvas_h = top_height + padding + rows * (cell_size + padding) + 28

    canvas = Image.new("RGB", (canvas_w, canvas_h), color=(19, 23, 27))
    draw = ImageDraw.Draw(canvas)

    for ix in range(cols):
        for iy in range(rows):
            x0 = left_width + padding + ix * (cell_size + padding)
            y0 = top_height + padding + iy * (cell_size + padding)
            x1 = x0 + cell_size
            y1 = y0 + cell_size

            draw.rounded_rectangle([x0, y0, x1, y1], radius=8, fill=(33, 38, 44), outline=(56, 64, 74), width=1)

            image = _load_cell_image(folder_path, ix, iy, z_slot, batch_index)
            if image is None:
                draw.line([x0 + 8, y0 + 8, x1 - 8, y1 - 8], fill=(170, 80, 80), width=2)
                draw.line([x1 - 8, y0 + 8, x0 + 8, y1 - 8], fill=(170, 80, 80), width=2)
                continue

            thumb = ImageOps.pad(image, (cell_size, cell_size), color=(26, 30, 35), method=Image.Resampling.LANCZOS)
            canvas.paste(thumb, (x0, y0))

    if show_labels:
        for ix, value in enumerate(values_x):
            x_center = left_width + padding + ix * (cell_size + padding) + cell_size // 2
            draw.text((x_center - (len(value) * 3), 20), value, fill=(215, 222, 230))

        for iy, value in enumerate(values_y):
            y_center = top_height + padding + iy * (cell_size + padding) + cell_size // 2
            draw.text((12, y_center - 6), value, fill=(215, 222, 230))

    z_label = values_z[z_index] if values_z else "(none)"
    footer = f"Folder: {folder_name} | Batch: {batch_index} | Z: {z_label}"
    draw.text((12, canvas_h - 18), footer, fill=(160, 170, 182))

    return canvas


def _pil_to_image_tensor(image: Image.Image) -> torch.Tensor:
    arr = np.asarray(image).astype(np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


def _empty_image_tensor() -> torch.Tensor:
    return torch.zeros((1, 1, 1, 3), dtype=torch.float32)


class ArtifySelectInputs(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ArtifySelectInputs",
            display_name="Select Inputs (Artify)",
            category=CATEGORY,
            description="Select any widget inputs in your graph to drive XYZ Plot axes.",
            inputs=[
                io.Combo.Input("input_1", options=["none"], default="none"),
                io.Combo.Input("input_2", options=["none"], default="none"),
                io.Combo.Input("input_3", options=["none"], default="none"),
                io.Combo.Input("input_4", options=["none"], default="none"),
                io.String.Input("preview", multiline=True, default=""),
            ],
            outputs=[
                INPUT_REF.Output("input_1"),
                INPUT_REF.Output("input_2"),
                INPUT_REF.Output("input_3"),
                INPUT_REF.Output("input_4"),
            ],
            search_aliases=["select inputs", "xyz inputs", "input selector"],
        )

    @classmethod
    def execute(
        cls,
        input_1: str,
        input_2: str,
        input_3: str,
        input_4: str,
        preview: str,
    ) -> io.NodeOutput:
        refs = [
            _parse_input_ref(input_1),
            _parse_input_ref(input_2),
            _parse_input_ref(input_3),
            _parse_input_ref(input_4),
        ]
        return io.NodeOutput(*refs)

    @classmethod
    def validate_inputs(cls, **kwargs) -> bool:
        # input_* combo options are populated client-side from the live graph.
        # Accept values beyond the static schema default ["none"].
        return True


class ArtifyXYZPlot(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ArtifyXYZPlot",
            display_name="XYZ Plot (Artify)",
            category=CATEGORY,
            description=(
                "Queues XYZ test runs by mutating selected widget inputs, then saves each generated image to a structured folder. "
                "Connect its output to XYZ Viewer (Artify) for in-node review."
            ),
            inputs=[
                io.Image.Input("images"),
                INPUT_REF.Input("input_x"),
                INPUT_REF.Input("input_y"),
                io.String.Input(
                    "value_x",
                    multiline=True,
                    placeholder='Values separated by semicolon, e.g. "A; B; C"',
                ),
                io.String.Input(
                    "value_y",
                    multiline=True,
                    placeholder='Values separated by semicolon, e.g. "A; B; C"',
                ),
                io.String.Input(
                    "value_z",
                    multiline=True,
                    default="",
                    placeholder='Optional values separated by semicolon, e.g. "A; B; C"',
                    optional=True,
                ),
                INPUT_REF.Input("input_z", optional=True),
                io.String.Input("output_folder_name", default="xyz_plot_artify"),
                io.Boolean.Input("archive_existing", default=True),
            ],
            outputs=[
                XYZ_PLOT_DATA.Output("xyz_plot"),
            ],
            hidden=[io.Hidden.unique_id],
            is_output_node=True,
            not_idempotent=True,
            search_aliases=["xyz", "grid search", "parameter sweep"],
        )

    @classmethod
    def fingerprint_inputs(cls, **kwargs) -> int:
        # Always execute: this node has side effects (queueing and file writes).
        return time.time_ns()

    @classmethod
    def execute(
        cls,
        images: torch.Tensor,
        input_x: dict[str, str],
        input_y: dict[str, str],
        value_x: str,
        value_y: str,
        output_folder_name: str,
        archive_existing: bool = True,
        input_z: dict[str, str] | None = None,
        value_z: str = "",
    ) -> io.NodeOutput:
        folder_name = _sanitize_folder_name(output_folder_name)

        if cls.hidden and cls.hidden.prompt and cls.hidden.unique_id is not None:
            prompt = cls.hidden.prompt
            unique_id = str(cls.hidden.unique_id)
            current_node = _ensure_prompt_node(prompt, unique_id)
            xyz_data = current_node.get("inputs", {}).get("xyz_data")

            if xyz_data:
                folder_name = _sanitize_folder_name(xyz_data.get("output_folder_name", folder_name))
                output_folder = _output_folder_path(folder_name)
                _save_images(
                    images=images,
                    output_folder=output_folder,
                    ix=int(xyz_data.get("x_index", 0)),
                    iy=int(xyz_data.get("y_index", 0)),
                    iz=int(xyz_data.get("z_index", -1)),
                )

                plot_data = {
                    "folder_name": folder_name,
                    "folder_path": output_folder,
                    "result_path": os.path.join(output_folder, "result.json"),
                }
                return io.NodeOutput(plot_data)

        if not isinstance(input_x, dict) or not isinstance(input_y, dict):
            raise ValueError("input_x and input_y must be valid INPUT references. Use Select Inputs (Artify).")

        values_x = _split_values(value_x)
        values_y = _split_values(value_y)
        values_z = _split_values(value_z)

        if not values_x or not values_y:
            raise ValueError("value_x and value_y must each contain at least one semicolon-separated value.")

        output_folder = _output_folder_path(folder_name)
        if archive_existing and os.path.exists(output_folder):
            backup_name = f"{output_folder}_old_{int(time.time())}"
            shutil.move(output_folder, backup_name)

        batch_size = int(images.shape[0]) if hasattr(images, "shape") and len(images.shape) > 0 else len(images)

        result_tree = _build_result_tree(
            folder_name=folder_name,
            values_x=values_x,
            values_y=values_y,
            values_z=values_z,
            batch_size=batch_size,
        )

        payload = {
            "format": "artify_xyz_plot_v1",
            "folder_name": folder_name,
            "created_at": int(time.time()),
            "values": {
                "x": values_x,
                "y": values_y,
                "z": values_z,
            },
            "batch_size": batch_size,
            "annotations": _build_annotations(input_x, input_y, input_z),
            "result": result_tree,
        }

        if cls.hidden and cls.hidden.extra_pnginfo and "workflow" in cls.hidden.extra_pnginfo:
            os.makedirs(output_folder, exist_ok=True)
            workflow_path = os.path.join(output_folder, "workflow.json")
            with open(workflow_path, "w", encoding="utf-8") as file:
                json.dump(cls.hidden.extra_pnginfo["workflow"], file, ensure_ascii=False, indent=2)
            payload["workflow"] = {"filename": "workflow.json"}

        _write_result_json(output_folder, payload)

        if not cls.hidden or not cls.hidden.prompt or cls.hidden.unique_id is None:
            plot_data = {
                "folder_name": folder_name,
                "folder_path": output_folder,
                "result_path": os.path.join(output_folder, "result.json"),
                "queued_jobs": 0,
                "batch_size": batch_size,
            }
            return io.NodeOutput(plot_data, ui={"plot_folder": [folder_name], "queued_jobs": [0]})

        prompt = cls.hidden.prompt
        unique_id = str(cls.hidden.unique_id)
        client_id = _current_client_id()
        viewer_node_ids = _find_viewer_node_ids(prompt, unique_id)

        queued = 0
        has_z = isinstance(input_z, dict) and len(values_z) > 0

        for ix, vx in enumerate(values_x):
            for iy, vy in enumerate(values_y):
                if has_z:
                    for iz, vz in enumerate(values_z):
                        new_prompt = copy.deepcopy(prompt)
                        _set_axis_value(new_prompt, input_x, vx)
                        _set_axis_value(new_prompt, input_y, vy)
                        _set_axis_value(new_prompt, input_z, vz)

                        xyz_payload = {
                            "source_unique_id": unique_id,
                            "output_folder_name": folder_name,
                            "x_index": ix,
                            "y_index": iy,
                            "z_index": iz,
                        }
                        _ensure_prompt_node(new_prompt, unique_id).setdefault("inputs", {})["xyz_data"] = xyz_payload
                        _queue_prompt(
                            new_prompt,
                            partial_execution_targets=[unique_id],
                            client_id=client_id,
                        )
                        queued += 1
                else:
                    new_prompt = copy.deepcopy(prompt)
                    _set_axis_value(new_prompt, input_x, vx)
                    _set_axis_value(new_prompt, input_y, vy)

                    xyz_payload = {
                        "source_unique_id": unique_id,
                        "output_folder_name": folder_name,
                        "x_index": ix,
                        "y_index": iy,
                        "z_index": -1,
                    }
                    _ensure_prompt_node(new_prompt, unique_id).setdefault("inputs", {})["xyz_data"] = xyz_payload
                    _queue_prompt(
                        new_prompt,
                        partial_execution_targets=[unique_id],
                        client_id=client_id,
                    )
                    queued += 1

        # After all cell-generation prompts are queued, schedule a final viewer
        # refresh prompt that reads directly from the output folder.
        if viewer_node_ids:
            viewer_prompt = _prepare_viewer_refresh_prompt(
                prompt=prompt,
                viewer_ids=viewer_node_ids,
                folder_name=folder_name,
                folder_path=output_folder,
            )
            _queue_prompt(
                viewer_prompt,
                partial_execution_targets=viewer_node_ids,
                client_id=client_id,
            )

        plot_data = {
            "folder_name": folder_name,
            "folder_path": output_folder,
            "result_path": os.path.join(output_folder, "result.json"),
            "queued_jobs": queued,
            "batch_size": batch_size,
        }

        return io.NodeOutput(plot_data, ui={"plot_folder": [folder_name], "queued_jobs": [queued]})


class ArtifyXYZViewer(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ArtifyXYZViewer",
            display_name="XYZ Viewer (Artify)",
            category=CATEGORY,
            description="Displays an XYZ result grid inside the node.",
            inputs=[
                XYZ_PLOT_DATA.Input("xyz_plot", optional=True),
            ],
            outputs=[],
            is_output_node=True,
            not_idempotent=True,
            search_aliases=["xyz viewer", "grid viewer", "parameter sweep viewer"],
        )

    @classmethod
    def fingerprint_inputs(cls, **kwargs) -> int:
        # The folder content changes while queued jobs complete; force refresh each run.
        return time.time_ns()

    @classmethod
    def execute(
        cls,
        xyz_plot: dict[str, Any] | None = None,
    ) -> io.NodeOutput:
        resolved_folder = ""
        if isinstance(xyz_plot, dict):
            incoming = xyz_plot.get("folder_name")
            if isinstance(incoming, str) and incoming.strip():
                resolved_folder = _sanitize_folder_name(incoming)

        # If this node runs without an upstream xyz_plot, keep it non-fatal.
        if not resolved_folder:
            return io.NodeOutput(ui={"plot_folder": []})

        folder_path = _output_folder_path(resolved_folder)

        if not os.path.isdir(folder_path):
            return io.NodeOutput(ui={"plot_folder": [resolved_folder]})

        plot_meta = _collect_plot_meta(folder_path)

        plot_data = {
            "folder_name": resolved_folder,
            "folder_path": folder_path,
            "result_path": os.path.join(folder_path, "result.json"),
            "batch_size": plot_meta["batch_size"],
            "x_count": len(plot_meta["values_x"]),
            "y_count": len(plot_meta["values_y"]),
            "z_count": len(plot_meta["z_slots"]) if plot_meta["z_slots"] != [-1] else 0,
        }

        return io.NodeOutput(
            ui={
                "plot_folder": [resolved_folder],
                "plot_data": [json.dumps(plot_data)],
            }
        )
