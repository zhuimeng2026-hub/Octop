"""Which release assets belong on Gitee.

Two rules decide it:

* a Gitee attachment may not exceed 100 MB, so the big ones stay on the
  GitHub Release and are only linked from the notes;
* this round delivers the Windows client only (see
  ``docs/desktop-windows-build.md``), so the macOS and Linux artifacts are
  left out as well.

Both the download page and the release notes use these rules, so they live
here instead of being written twice.
"""

from __future__ import annotations

GITEE_ATTACHMENT_LIMIT_MB = 100
GITEE_ATTACHMENT_LIMIT_BYTES = GITEE_ATTACHMENT_LIMIT_MB * 1024 * 1024

# The platform tokens the release asset names carry.
PLATFORMS = ("windows", "darwin", "linux")


def is_small(asset: dict) -> bool:
    """Gitee takes one attachment up to 100 MB; bigger ones stay on GitHub."""
    return asset.get("size", 0) < GITEE_ATTACHMENT_LIMIT_BYTES


def platform_of(name: str) -> str | None:
    """The platform an asset belongs to, None when it fits every platform."""
    lowered = name.lower()
    for platform in PLATFORMS:
        if platform in lowered:
            return platform
    return None


def matches_platform(name: str, platform: str | None) -> bool:
    """Whether an asset belongs to the platform this round delivers.

    An empty platform or ``all`` keeps every asset. Assets without a
    platform token (the wheel, the sdist, the fnOS package) always belong.
    """
    if not platform or platform == "all":
        return True
    asset_platform = platform_of(name)
    return asset_platform is None or asset_platform == platform


def select(assets: list[dict], platform: str | None) -> tuple[list[dict], list[dict]]:
    """Split the assets into the ones Gitee carries and the ones it links.

    The first list fits both the attachment limit and the platform, the
    second holds everything that is too big for a Gitee attachment.
    """
    wanted = [a for a in assets if matches_platform(a.get("name", ""), platform)]
    small = [a for a in wanted if is_small(a)]
    large = [a for a in wanted if not is_small(a)]
    return small, large
