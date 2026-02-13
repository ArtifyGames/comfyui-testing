from typing_extensions import override
from comfy_api.latest import ComfyExtension, io

import server

from .nodes import ArtifyXYZPlot, ArtifyXYZViewer
from .routes import api_get_xyz_images, api_get_xyz_result

WEB_DIRECTORY = "./web"


def _register_routes() -> None:
    prompt_server = getattr(server.PromptServer, "instance", None)
    if prompt_server is None:
        return

    try:
        prompt_server.routes.get("/artify_testing/xyz/result")(api_get_xyz_result)
    except Exception:
        # Route is already registered (e.g. module reload).
        pass
    try:
        prompt_server.routes.get("/artify_testing/xyz/images")(api_get_xyz_images)
    except Exception:
        # Route is already registered (e.g. module reload).
        pass


_register_routes()


class ComfyUITestingExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            ArtifyXYZPlot,
            ArtifyXYZViewer,
        ]


async def comfy_entrypoint() -> ComfyUITestingExtension:
    return ComfyUITestingExtension()


__all__ = ["WEB_DIRECTORY", "comfy_entrypoint", "ComfyUITestingExtension"]
