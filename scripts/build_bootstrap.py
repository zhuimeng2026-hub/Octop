"""Package ``bootstrap/`` into a release artifact.

The bootstrapper itself stays tiny (a few tens of KB): it only ships the GUI
launcher plus ``bootstrap.conf`` and downloads everything else at run time.

    python scripts/build_bootstrap.py                  # dist/Octop-bootstrap-<ver>.zip
    python scripts/build_bootstrap.py --with-wheel     # also embed dist/octop-*.whl
"""

from __future__ import annotations

import argparse
import re
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BOOTSTRAP_DIR = REPO_ROOT / "bootstrap"
DIST_DIR = REPO_ROOT / "dist"

SKIP_NAMES = {".DS_Store"}
SKIP_SUFFIXES = {".pyc", ".log", ".tmp"}
SKIP_DIRS = {"__pycache__", "payload"}


def project_version() -> str:
    text = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    match = re.search(r'^version\s*=\s*"([^"]+)"', text, re.M)
    if not match:
        raise SystemExit("could not read version from pyproject.toml")
    return match.group(1)


def iter_sources() -> list[Path]:
    if not BOOTSTRAP_DIR.is_dir():
        raise SystemExit(f"bootstrap directory not found: {BOOTSTRAP_DIR}")
    return sorted(p for p in BOOTSTRAP_DIR.rglob("*") if p.is_file())


def is_skipped(path: Path) -> bool:
    rel = path.relative_to(BOOTSTRAP_DIR)
    if any(part in SKIP_DIRS for part in rel.parts):
        return True
    return path.name in SKIP_NAMES or path.suffix in SKIP_SUFFIXES


def find_wheel() -> Path | None:
    wheels = sorted(DIST_DIR.glob("octop-*.whl"), key=lambda p: p.stat().st_mtime, reverse=True)
    return wheels[0] if wheels else None


def build(with_wheel: bool, out_dir: Path) -> Path:
    version = project_version()
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"Octop-bootstrap-{version}.zip"

    wheel = find_wheel() if with_wheel else None
    if with_wheel and wheel is None:
        raise SystemExit("no dist/octop-*.whl found — run `make build-wheel` first")

    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in iter_sources():
            if is_skipped(path):
                continue
            rel = path.relative_to(BOOTSTRAP_DIR).as_posix()
            info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o755 << 16 if path.suffix == ".sh" else 0o644 << 16
            zf.writestr(info, path.read_bytes())
        if wheel is not None:
            zf.write(wheel, arcname=f"payload/{wheel.name}")

    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Package the Octop download bootstrapper.")
    parser.add_argument(
        "--with-wheel", action="store_true", help="embed dist/octop-*.whl as payload/"
    )
    parser.add_argument("--out-dir", default=str(DIST_DIR), help="output directory (default: dist)")
    args = parser.parse_args(argv)

    target = build(args.with_wheel, Path(args.out_dir))
    size_kb = target.stat().st_size / 1024
    print(f"[bootstrap] {target}  ({size_kb:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
