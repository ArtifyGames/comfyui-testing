import copy
import functools
import json
import os
import re
import shutil
import time
from datetime import datetime
from typing import Any

import numpy as np
import requests
import torch
from PIL import Image
from requests.adapters import HTTPAdapter, Retry

import folder_paths
from comfy.cli_args import args
from comfy_api.latest import io

XYZ_PLOT_DATA = io.Custom("ARTIFY_XYZ_PLOT")

CATEGORY = "Artify/Testing"
SPLITTER = "::"
DEFAULT_OUTPUT_FOLDER_TEMPLATE = (
    "%date:yyMMdd%_X_%inputx_node_title%_%inputx_widget_name%_Y_%inputy_node_title%_%inputy_widget_name%_Z_%inputz_node_title%_%inputz_widget_name%"
)
DATE_TOKEN_PATTERN = re.compile(r"%date:([^%]+)%")


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


def _sanitize_template_component(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", text)
    text = re.sub(r"\s+", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    return text


def _format_custom_date(pattern: str, now: datetime) -> str:
    # Supports common SaveImage-style date tokens such as yyMMdd or yyyy-MM-dd_HH-mm-ss.
    token_values = {
        "yyyy": f"{now.year:04d}",
        "yy": f"{now.year % 100:02d}",
        "MM": f"{now.month:02d}",
        "M": str(now.month),
        "dd": f"{now.day:02d}",
        "d": str(now.day),
        "HH": f"{now.hour:02d}",
        "H": str(now.hour),
        "mm": f"{now.minute:02d}",
        "m": str(now.minute),
        "ss": f"{now.second:02d}",
        "s": str(now.second),
    }
    ordered_tokens = sorted(token_values.keys(), key=len, reverse=True)

    out: list[str] = []
    idx = 0
    while idx < len(pattern):
        matched = False
        for token in ordered_tokens:
            if pattern.startswith(token, idx):
                out.append(token_values[token])
                idx += len(token)
                matched = True
                break
        if matched:
            continue
        out.append(pattern[idx])
        idx += 1
    return "".join(out)


def _expand_output_folder_template(
    template: str,
    axis_x: dict[str, str] | None,
    axis_y: dict[str, str] | None,
    axis_z: dict[str, str] | None,
) -> str:
    raw = str(template or "").strip() or DEFAULT_OUTPUT_FOLDER_TEMPLATE
    if axis_z is None:
        # Remove the canonical Z suffix block when Z axis is not used.
        raw = raw.replace("_Z_%inputz_node_title%_%inputz_widget_name%", "")
        raw = raw.replace("Z_%inputz_node_title%_%inputz_widget_name%", "")
    now = datetime.now()

    def _replace_date(match: re.Match[str]) -> str:
        fmt = str(match.group(1) or "").strip()
        if not fmt:
            return ""
        return _format_custom_date(fmt, now)

    out = DATE_TOKEN_PATTERN.sub(_replace_date, raw)
    out = (
        out.replace("%year%", f"{now.year:04d}")
        .replace("%month%", f"{now.month:02d}")
        .replace("%day%", f"{now.day:02d}")
        .replace("%hour%", f"{now.hour:02d}")
        .replace("%minute%", f"{now.minute:02d}")
        .replace("%second%", f"{now.second:02d}")
    )

    replacements = {
        "inputx_node_title": _sanitize_template_component(axis_x.get("node_title")) if axis_x else "",
        "inputx_widget_name": _sanitize_template_component(axis_x.get("widget_name")) if axis_x else "",
        "inputy_node_title": _sanitize_template_component(axis_y.get("node_title")) if axis_y else "",
        "inputy_widget_name": _sanitize_template_component(axis_y.get("widget_name")) if axis_y else "",
        "inputz_node_title": _sanitize_template_component(axis_z.get("node_title")) if axis_z else "",
        "inputz_widget_name": _sanitize_template_component(axis_z.get("widget_name")) if axis_z else "",
    }
    for token, value in replacements.items():
        out = out.replace(f"%{token}%", value)

    out = out.replace("\\", "/")
    out = re.sub(r"\s+", "_", out)
    out = re.sub(r"_+", "_", out)
    out = re.sub(r"/+", "/", out)
    out = re.sub(r"_*/_*", "/", out)
    out = out.strip(" _/")
    return _sanitize_folder_name(out)


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
                io.String.Input("output_folder_name", default=DEFAULT_OUTPUT_FOLDER_TEMPLATE),
                io.Combo.Input("input_x", options=["none"], default="none"),
                io.String.Input(
                    "value_x",
                    multiline=True,
                    placeholder="6.5; 7.0; 7.5",
                    default="6.5; 7.0; 7.5",
                ),
                io.Combo.Input("input_y", options=["none"], default="none"),
                io.String.Input(
                    "value_y",
                    multiline=True,
                    placeholder="20; 30; 40",
                    default="20; 30; 40",
                ),
                io.Combo.Input("input_z", options=["none"], default="none", optional=True),
                io.String.Input(
                    "value_z",
                    multiline=True,
                    placeholder="Euler; Heun",
                    default="Euler; Heun",
                    optional=True,
                ),
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
    def validate_inputs(cls, **kwargs) -> bool:
        # input_x/y/z combo options are populated client-side from the live graph.
        # Accept values beyond the static schema default ["none"].
        return True

    @classmethod
    def execute(
        cls,
        images: torch.Tensor,
        output_folder_name: str,
        input_x: str,
        value_x: str,
        input_y: str,
        value_y: str,
        input_z: str = "none",
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

        axis_x = _parse_input_ref(input_x)
        axis_y = _parse_input_ref(input_y)
        axis_z = _parse_input_ref(input_z)

        if not axis_x or not axis_y:
            raise ValueError("input_x and input_y must be selected to valid graph widget references.")

        values_x = _split_values(value_x)
        values_y = _split_values(value_y)
        values_z = _split_values(value_z)

        if not values_x or not values_y:
            raise ValueError("value_x and value_y must each contain at least one semicolon-separated value.")
        if values_z and axis_z is None:
            raise ValueError("value_z was provided, but input_z is not selected.")

        effective_values_z = values_z if axis_z is not None else []
        folder_name = _expand_output_folder_template(output_folder_name, axis_x, axis_y, axis_z if effective_values_z else None)

        output_folder = _output_folder_path(folder_name)
        if os.path.exists(output_folder):
            backup_name = f"{output_folder}_old_{int(time.time())}"
            shutil.move(output_folder, backup_name)

        batch_size = int(images.shape[0]) if hasattr(images, "shape") and len(images.shape) > 0 else len(images)

        result_tree = _build_result_tree(
            folder_name=folder_name,
            values_x=values_x,
            values_y=values_y,
            values_z=effective_values_z,
            batch_size=batch_size,
        )

        payload = {
            "format": "artify_xyz_plot_v1",
            "folder_name": folder_name,
            "created_at": int(time.time()),
            "values": {
                "x": values_x,
                "y": values_y,
                "z": effective_values_z,
            },
            "batch_size": batch_size,
            "annotations": _build_annotations(axis_x, axis_y, axis_z if effective_values_z else None),
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
        has_z = len(effective_values_z) > 0

        for ix, vx in enumerate(values_x):
            for iy, vy in enumerate(values_y):
                if has_z:
                    for iz, vz in enumerate(effective_values_z):
                        new_prompt = copy.deepcopy(prompt)
                        _set_axis_value(new_prompt, axis_x, vx)
                        _set_axis_value(new_prompt, axis_y, vy)
                        _set_axis_value(new_prompt, axis_z, vz)

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
                    _set_axis_value(new_prompt, axis_x, vx)
                    _set_axis_value(new_prompt, axis_y, vy)

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
