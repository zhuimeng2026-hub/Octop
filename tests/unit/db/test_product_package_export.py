"""Local video packages must contain a complete, immutable, user-scoped job."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.product_library import ProductLibraryRepo
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.product_library import package_export
from octop.infra.product_library.service import ProductLibraryService
from octop.infra.utils.paths import PathLayout


@pytest.fixture
def package_library(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    pool = SqlitePool(tmp_path / "control.db")
    run_migrations(pool)
    repo = ProductLibraryRepo(pool)
    paths = PathLayout(tmp_path / "data")
    service = ProductLibraryService(paths, repo)
    template = tmp_path / "template"
    for filename in package_export.TEMPLATE_FILES:
        target = template / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("reviewed renderer source", encoding="utf-8")
    for filename in package_export.LAUNCHERS:
        target = template / "launchers" / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("preview launcher", encoding="utf-8")
    (template / "secret.env").write_text("must not be exported", encoding="utf-8")
    monkeypatch.setattr(package_export, "template_root", lambda: template)
    return repo, paths, service


def test_package_includes_only_referenced_assets_and_locked_runtime(package_library) -> None:
    repo, paths, service = package_library
    product = repo.create_product(1, {"name": "Original product", "selling_points": ["A fact"]})
    image = service.store_asset(
        owner_id=1,
        product_id=product["id"],
        filename="产品.png",
        media_type="image/png",
        data=b"scene image",
        usage="scene",
    )
    reference = service.store_asset(
        owner_id=1,
        product_id=product["id"],
        filename="internal.pdf",
        media_type="application/pdf",
        data=b"internal reference",
        usage="reference",
    )
    project = service.create_snapshot(
        owner_id=1, product_id=product["id"], name="Video", asset_ids=[image["id"], reference["id"]]
    )
    repo.update_product(1, product["id"], {"name": "Changed product"})
    repo.delete_product(1, product["id"])
    output = package_export.export_project_package(paths, project)
    try:
        with ZipFile(output) as archive:
            names = archive.namelist()
            script_bytes = archive.read("script.json")
            script = json.loads(script_bytes)
            manifest = json.loads(archive.read("manifest.json"))
            assert script["title"] == "Original product"
            assert manifest["script_sha256"] == hashlib.sha256(script_bytes).hexdigest()
            assert manifest["schema"] == "octop-remotion-package/1"
            assert len(manifest["assets"]) == 1
            asset = manifest["assets"][0]
            assert archive.read(asset["path"]) == b"scene image"
            assert asset["sha256"] == hashlib.sha256(b"scene image").hexdigest()
            assert asset["bytes"] == len(b"scene image")
            assert "renderer/package-lock.json" in names
            assert "renderer/launch.mjs" in names
            assert "preview.cmd" in names and "render.command" in names
            assert archive.getinfo("preview.command").external_attr >> 16 & 0o111
            assert not any("internal.pdf" in name or "secret.env" in name for name in names)
    finally:
        output.unlink(missing_ok=True)


def test_export_rejects_changed_asset_bytes(package_library) -> None:
    repo, paths, service = package_library
    product = repo.create_product(1, {"name": "Product"})
    image = service.store_asset(
        owner_id=1,
        product_id=product["id"],
        filename="image.png",
        media_type="image/png",
        data=b"original",
        usage="scene",
    )
    project = service.create_snapshot(
        owner_id=1, product_id=product["id"], name="Video", asset_ids=[image["id"]]
    )
    (paths.product_library_dir / image["storage_path"]).write_bytes(b"modified")
    with pytest.raises(OctopError) as raised:
        package_export.export_project_package(paths, project)
    assert raised.value.code is ErrorCode.NOT_FOUND


def test_text_only_package_has_assets_directory(package_library) -> None:
    repo, paths, service = package_library
    product = repo.create_product(1, {"name": "Text-only product"})
    project = service.create_snapshot(owner_id=1, product_id=product["id"], name="Video", asset_ids=[])
    output = package_export.export_project_package(paths, project)
    try:
        with ZipFile(output) as archive:
            assert "assets/" in archive.namelist()
            assert json.loads(archive.read("manifest.json"))["assets"] == []
    finally:
        output.unlink(missing_ok=True)
