"""Build GitHub Release download-section markdown from a version tag.

Same pattern as clash-verge-rev: interpolate TAG / VERSION into a fixed
filename table. Do not scrape the assets list.

    python3 scripts/release_download_links.py 0.9.31
    python3 scripts/release_download_links.py v0.9.31
"""

from __future__ import annotations

import argparse
import sys

GITHUB_REPO = "TencentCloud/Octop"
DOWNLOAD_BASE = f"https://github.com/{GITHUB_REPO}/releases/download"


def split_tag(raw: str) -> tuple[str, str]:
    """Return ``(tag, version)`` — tag always has a leading ``v``."""
    text = raw.strip()
    if not text:
        raise ValueError("version is empty")
    version = text[1:] if text.startswith("v") else text
    return f"v{version}", version


def asset_url(tag: str, filename: str) -> str:
    return f"{DOWNLOAD_BASE}/{tag}/{filename}"


def md_link(label: str, tag: str, filename: str) -> str:
    return f"[{label}]({asset_url(tag, filename)})"


def desktop_name(os_name: str, arch: str, version: str, ext: str) -> str:
    return f"Octop-desktop-{os_name}-{arch}-{version}.{ext}"


def portable_name(os_name: str, arch: str, version: str) -> str:
    return f"Octop-portable-{os_name}-{arch}-{version}.zip"


def slim_name(os_name: str, arch: str, version: str, ext: str) -> str:
    return f"Octop-desktop-slim-{os_name}-{arch}-{version}.{ext}"


def render_download_section(raw_version: str) -> str:
    tag, version = split_tag(raw_version)
    win64 = md_link("64-bit (Recommended)", tag, desktop_name("windows", "amd64", version, "exe"))
    win_arm = md_link("ARM64", tag, desktop_name("windows", "arm64", version, "exe"))
    win64_zip = md_link("64-bit", tag, portable_name("windows", "amd64", version))
    win_arm_zip = md_link("ARM64", tag, portable_name("windows", "arm64", version))
    mac_arm = md_link("Apple Silicon", tag, desktop_name("darwin", "arm64", version, "dmg"))
    mac_intel = md_link("Intel", tag, desktop_name("darwin", "amd64", version, "dmg"))
    mac_arm_zip = md_link("Apple Silicon", tag, portable_name("darwin", "arm64", version))
    mac_intel_zip = md_link("Intel", tag, portable_name("darwin", "amd64", version))
    linux64 = md_link("64-bit", tag, desktop_name("linux", "amd64", version, "tar.gz"))
    linux_arm = md_link("ARM64", tag, desktop_name("linux", "arm64", version, "tar.gz"))
    linux64_zip = md_link("64-bit", tag, portable_name("linux", "amd64", version))
    linux_arm_zip = md_link("ARM64", tag, portable_name("linux", "arm64", version))
    slim_win64 = md_link("64-bit", tag, slim_name("windows", "amd64", version, "exe"))
    slim_win_arm = md_link("ARM64", tag, slim_name("windows", "arm64", version, "exe"))
    slim_mac_arm = md_link("Apple Silicon", tag, slim_name("darwin", "arm64", version, "dmg"))
    slim_mac_intel = md_link("Intel", tag, slim_name("darwin", "amd64", version, "dmg"))
    slim_linux64 = md_link("64-bit", tag, slim_name("linux", "amd64", version, "tar.gz"))
    slim_linux_arm = md_link("ARM64", tag, slim_name("linux", "arm64", version, "tar.gz"))
    fnos_docker = md_link(
        "Docker (recommended; x86 and ARM)", tag, f"Octop-fnos-docker-{version}.fpk"
    )
    fnos_native = md_link("Native x86_64", tag, f"Octop-fnos-native-{version}.fpk")
    fnos_native_arm = md_link(
        "Native ARM64 (no Docker)", tag, f"Octop-fnos-native-arm64-{version}.fpk"
    )
    return "\n".join(
        [
            "",
            "## Downloads",
            "",
            "### Windows",
            "",
            "#### Desktop installer (Recommended)",
            f"- {win64} | {win_arm}",
            "",
            "#### Portable",
            f"- {win64_zip} | {win_arm_zip}",
            "",
            "### macOS",
            "",
            "#### Desktop installer (Recommended)",
            f"- {mac_arm} | {mac_intel}",
            "",
            "#### Portable",
            f"- {mac_arm_zip} | {mac_intel_zip}",
            "",
            "### Linux",
            "",
            "#### Desktop installer (Recommended)",
            f"- {linux64} | {linux_arm}",
            "",
            "#### Portable",
            f"- {linux64_zip} | {linux_arm_zip}",
            "",
            "### fnOS NAS",
            f"- {fnos_docker} | {fnos_native} | {fnos_native_arm}",
            "",
            "### Slim installers",
            "",
            "The installers above bundle the whole runtime (~300 MB). The slim",
            "installers ship only the shell (~20 MB) and fetch the runtime on",
            "first launch — one download at that point, offline afterwards.",
            "",
            f"- Windows: {slim_win64} | {slim_win_arm}",
            f"- macOS: {slim_mac_arm} | {slim_mac_intel}",
            f"- Linux: {slim_linux64} | {slim_linux_arm}",
            "",
        ]
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Print Octop GitHub Release download markdown.")
    parser.add_argument("version", help="Package version, with or without a leading v")
    args = parser.parse_args(argv)
    sys.stdout.write(render_download_section(args.version))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
