"""Narration entitlement and server-side synthesis for product videos.

Two tiers exist:

* **Free** — the Windows desktop client synthesises the voice locally with
  SAPI. The server only declares the lines; no audio is produced here.
* **Paid** — the server renders each line with MiniMax and ships the clips
  inside the package, so the client needs nothing but the package itself.

Entitlement is expressed by the ``voice_tts_premium`` permission, which the
"付费用户" role carries. Administrators bypass it like every other permission.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from octop.infra.errors import ErrorCode, OctopError
from octop.infra.product_library.audio import scene_narration_text
from octop.infra.users.permissions import user_has_permission
from octop.infra.voice import adapters

#: Provider name of the MiniMax row in the ``voice_providers`` table.
MINIMAX_PROVIDER_NAME = "minimax"

#: Voice presets offered to paid users.
PAID_VOICE_PRESETS: tuple[dict[str, str], ...] = (
    {"id": "female-shaonv", "label": "少女音"},
    {"id": "female-yuexian", "label": "御姐音"},
    {"id": "male-qingse", "label": "青涩男声"},
    {"id": "male-chengshu", "label": "成熟男声"},
    {"id": "presenter_female", "label": "亲和女声"},
)


def has_premium_narration(user: Any) -> bool:
    """Whether the account may use server-side premium narration."""
    try:
        return user_has_permission(user, "voice_tts_premium")
    except Exception:
        return False


def resolve_voice_preset(voice_id: str | None) -> str | None:
    """Keep only known preset ids; unknown values fall back to the default."""
    if not voice_id:
        return None
    for preset in PAID_VOICE_PRESETS:
        if preset["id"] == voice_id:
            return voice_id
    return None


async def _synthesize_line(
    manager: Any, text: str, *, voice_id: str | None
) -> tuple[bytes, float] | None:
    """Render one line with the configured MiniMax provider.

    Returns the audio and its measured duration in seconds. MiniMax reports
    the rendered length in ``extra_info.audio_length`` (milliseconds); the
    duration is needed to size the scene so the narration is never cut off.
    """
    try:
        provider = manager.resolve(MINIMAX_PROVIDER_NAME)
    except OctopError:
        return None
    row = provider.row
    if row is None or not (row.api_key or ""):
        return None
    chunks: list[bytes] = []
    measured = 0.0

    def _record(length_ms: float) -> None:
        nonlocal measured
        measured = length_ms

    try:
        async for chunk in adapters.synthesize_minimax(
            row, text, voice_id=voice_id, speed=1.0, on_length=_record
        ):
            chunks.append(chunk)
    except OctopError:
        raise
    except Exception as exc:  # network / upstream failures surface as 502
        raise OctopError(
            ErrorCode.VOICE_PROVIDER_ERROR,
            "narration synthesis failed",
            details={"reason": type(exc).__name__},
        ) from exc
    if not chunks:
        return None
    return b"".join(chunks), measured / 1000.0


async def render_narration_clips(
    *,
    manager: Any,
    script: dict[str, Any],
    voice_id: str | None,
) -> tuple[dict[str, Path], dict[str, float]]:
    """Render every narration line of a script.

    Returns the rendered clips keyed by scene id together with their measured
    durations in seconds. An empty mapping means the provider is not
    configured, so a paid user without credentials still gets a package —
    just without the voice.
    """
    scenes = script.get("scenes") or []
    if not isinstance(scenes, list):
        return {}, {}
    preset = resolve_voice_preset(voice_id)
    outputs: dict[str, Path] = {}
    durations: dict[str, float] = {}
    tmpdir = Path(tempfile.mkdtemp(prefix="octop-narration-"))
    for scene in scenes:
        if not isinstance(scene, dict):
            continue
        scene_id = str(scene.get("id") or "")
        if not scene_id:
            continue
        line = scene_narration_text(scene)
        if not line:
            continue
        result = await _synthesize_line(manager, line, voice_id=preset)
        if result is None:
            continue
        audio, measured = result
        target = tmpdir / f"{scene_id}.mp3"
        target.write_bytes(audio)
        outputs[scene_id] = target
        if measured > 0:
            durations[scene_id] = measured
    return outputs, durations
