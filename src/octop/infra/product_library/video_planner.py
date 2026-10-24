"""Backend-only video planning MVP compatible with the existing Remotion script.

This deliberately uses deterministic copy and the customer's approved product
facts. A future low-cost LLM may replace copy selection without changing API.
"""
from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field

from octop.infra.product_library.service import render_script


class VideoPlanRequest(BaseModel):
    instructions: str = Field(default="", max_length=3000)
    format: Literal["landscape", "portrait", "square"] = "portrait"
    language: Literal["zh", "en"] = "zh"
    seconds_per_asset: int = Field(default=4, ge=1, le=15)
    include_selling_points: bool = True


def build_video_plan(snapshot: dict[str, Any], request: VideoPlanRequest) -> dict[str, Any]:
    """Plan with snapshot assets only; never permit arbitrary asset paths."""
    script, assets = render_script(snapshot)
    product = snapshot["product"]
    width, height = {"landscape": (1920, 1080), "portrait": (1080, 1920), "square": (1080, 1080)}[request.format]
    scenes = script["scenes"]
    if not request.include_selling_points:
        scenes = [scene for scene in scenes if scene["type"] != "bullets"]
    for scene in scenes:
        if scene["type"] in {"image", "video"}:
            scene["duration"] = request.seconds_per_asset
    # Instructions are project briefing metadata, NOT unchecked render commands.
    script.update({"width": width, "height": height, "scenes": scenes})
    return {
        "script": script,
        "assets": [{"id": a["id"], "export_name": a["export_name"], "media_type": a["media_type"]} for a in assets],
        "brief": {
            "instructions": request.instructions,
            "language": request.language,
            "format": request.format,
            "product_name": product["name"],
        },
        "generator": "template-v1",
    }
