"""Focused backend video planner tests, no model calls or desktop dependencies."""
import pytest
from pydantic import ValidationError

from octop.infra.product_library.video_planner import VideoPlanRequest, build_video_plan


def sample():
    return {
        "product": {"name": "Canvas Bag", "model": "A1", "selling_points": ["Durable"]},
        "assets": [{
            "id": "asset1", "filename": "bag.png", "media_type": "image/png",
            "usage": "scene", "priority": 1,
        }],
    }


def test_portrait_plan_reuses_snapshot_assets():
    result = build_video_plan(sample(), VideoPlanRequest(instructions="Show capacity"))
    script = result["script"]
    assert (script["width"], script["height"]) == (1080, 1920)
    assert script["scenes"][0]["type"] == "title"
    media = [scene for scene in script["scenes"] if scene["type"] == "image"]
    assert len(media) == 1 and media[0]["duration"] == 4
    assert media[0]["asset"] == result["assets"][0]["export_name"]
    assert result["generator"] == "template-v1"


def test_without_bullets_and_landscape():
    result = build_video_plan(
        sample(), VideoPlanRequest(format="landscape", include_selling_points=False, seconds_per_asset=7)
    )
    assert result["script"]["width"] == 1920
    assert all(scene["type"] != "bullets" for scene in result["script"]["scenes"])
    assert any(scene.get("duration") == 7 for scene in result["script"]["scenes"])


def test_invalid_plan_values_are_rejected():
    with pytest.raises(ValidationError):
        VideoPlanRequest(seconds_per_asset=0)
    with pytest.raises(ValidationError):
        VideoPlanRequest(format="unsupported")
