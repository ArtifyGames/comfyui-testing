import os
import json
from aiohttp import web

import folder_paths

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"}


def _sanitize_folder_name(name: str) -> str:
    value = (name or "").strip().replace("\\", "/")
    value = value.strip("/")
    value = value.replace("..", "")
    return value


async def api_get_xyz_result(request):
    folder_name = _sanitize_folder_name(request.query.get("folder_name", ""))
    if not folder_name:
        return web.json_response({"error": "folder_name is required"}, status=400)

    folder_path = os.path.join(folder_paths.get_output_directory(), folder_name)
    result_path = os.path.join(folder_path, "result.json")

    if not os.path.exists(result_path):
        return web.json_response({"error": f"result.json not found for folder '{folder_name}'"}, status=404)

    try:
        with open(result_path, "r", encoding="utf-8") as file:
            payload = json.load(file)
    except Exception as error:
        return web.json_response({"error": f"failed to read result.json: {error}"}, status=500)

    payload["folder_name"] = folder_name
    return web.json_response(payload)


async def api_get_xyz_images(request):
    folder_name = _sanitize_folder_name(request.query.get("folder_name", ""))
    if not folder_name:
        return web.json_response({"error": "folder_name is required"}, status=400)

    folder_path = os.path.join(folder_paths.get_output_directory(), folder_name)
    if not os.path.isdir(folder_path):
        return web.json_response({"error": f"folder not found: '{folder_name}'"}, status=404)

    files = []
    for entry in os.scandir(folder_path):
        if not entry.is_file():
            continue
        if os.path.splitext(entry.name)[1].lower() not in IMAGE_EXTENSIONS:
            continue
        files.append(entry.name)

    files.sort(key=lambda value: value.lower())
    return web.json_response({"folder_name": folder_name, "files": files})
