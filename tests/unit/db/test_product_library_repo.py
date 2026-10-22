"""Persistence and immutable snapshot behavior for the product library."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.product_library import ProductLibraryRepo
from octop.infra.product_library.service import ProductLibraryService, render_script
from octop.infra.utils.paths import PathLayout


@pytest.fixture
def repo(tmp_path: Path) -> ProductLibraryRepo:
    db = SqlitePool(tmp_path / "octop.db")
    run_migrations(db)
    return ProductLibraryRepo(db)


def _product(repo: ProductLibraryRepo, owner: int, name: str) -> dict[str, Any]:
    return repo.create_product(
        owner,
        {
            "name": name,
            "model": "M1",
            "category": "camera",
            "selling_points": ["clear image"],
            "parameters": {"weight": "120g"},
            "expression_limits": "Do not claim waterproof",
        },
    )


def test_owner_isolation_and_public_ids(repo: ProductLibraryRepo) -> None:
    first = _product(repo, 1, "First")
    second = _product(repo, 2, "Second")
    assert first["pk"] > 0
    assert len(first["id"]) == 26
    assert first["id"] != second["id"]
    assert [row["id"] for row in repo.list_products(1)] == [first["id"]]
    assert repo.get_product(2, first["id"]) is None


def test_asset_paths_and_snapshot_remain_stable_after_product_edit_or_delete(
    repo: ProductLibraryRepo, tmp_path: Path
) -> None:
    paths = PathLayout(tmp_path / "octop")
    service = ProductLibraryService(paths, repo)
    product = _product(repo, 4, "Original")
    one = service.store_asset(
        owner_id=4,
        product_id=product["id"],
        filename="same.png",
        media_type="image/png",
        data=b"png1",
        usage="scene",
    )
    two = service.store_asset(
        owner_id=4,
        product_id=product["id"],
        filename="same.png",
        media_type="image/png",
        data=b"png2",
        usage="reference",
    )
    doc = service.store_asset(
        owner_id=4,
        product_id=product["id"],
        filename="brief.pdf",
        media_type="application/pdf",
        data=b"pdf",
        usage="reference",
    )
    assert one["id"] != two["id"]
    assert (paths.product_library_dir / one["storage_path"]).read_bytes() == b"png1"
    assert (paths.product_library_dir / two["storage_path"]).read_bytes() == b"png2"
    project = service.create_snapshot(
        owner_id=4,
        product_id=product["id"],
        name="Spring",
        asset_ids=[one["id"], two["id"], doc["id"]],
    )

    repo.update_product(4, product["id"], {"name": "Edited"})
    repo.update_asset(4, one["id"], active=False)
    repo.delete_product(4, product["id"])

    stored = repo.get_project(4, project["id"])
    snapshot = json.loads(stored["snapshot_json"])
    assert snapshot["product"]["name"] == "Original"
    assert {asset["id"] for asset in snapshot["assets"]} == {one["id"], two["id"], doc["id"]}
    script, exported = render_script(snapshot)
    assert [scene["asset"] for scene in script["scenes"] if "asset" in scene] == [
        exported[0]["export_name"]
    ]
    assert exported[0]["export_name"].startswith(one["id"] + "-")
    assert "brief.pdf" not in json.dumps(script)


def test_identical_upload_reuses_asset_only_within_product_owner(
    repo: ProductLibraryRepo, tmp_path: Path
) -> None:
    service = ProductLibraryService(PathLayout(tmp_path / "octop"), repo)
    first_product = _product(repo, 2, "First")
    other_owner_product = _product(repo, 3, "Other")
    first = service.store_asset(
        owner_id=2,
        product_id=first_product["id"],
        filename="a.png",
        media_type="image/png",
        data=b"same bytes",
        usage="scene",
    )
    duplicate = service.store_asset(
        owner_id=2,
        product_id=first_product["id"],
        filename="b.png",
        media_type="image/png",
        data=b"same bytes",
        usage="style",
    )
    other_owner = service.store_asset(
        owner_id=3,
        product_id=other_owner_product["id"],
        filename="a.png",
        media_type="image/png",
        data=b"same bytes",
        usage="scene",
    )
    assert first["id"] == duplicate["id"]
    assert duplicate["usage"] == "scene"
    assert first["id"] != other_owner["id"]


class _Workspace:
    def __init__(self, fail_on: str | None = None) -> None:
        self.files: dict[str, bytes] = {}
        self.fail_on = fail_on

    async def amkdir(self, _path: str) -> None:
        return None

    async def aupload_bytes(self, path: str, data: bytes) -> None:
        if path == self.fail_on:
            raise OSError("upload failed")
        self.files[path] = data


@pytest.mark.asyncio
async def test_prepare_render_uploads_assets_then_script(
    repo: ProductLibraryRepo, tmp_path: Path
) -> None:
    paths = PathLayout(tmp_path / "octop")
    service = ProductLibraryService(paths, repo)
    product = _product(repo, 9, "Tripod")
    asset = service.store_asset(
        owner_id=9,
        product_id=product["id"],
        filename="clip.mp4",
        media_type="video/mp4",
        data=b"video",
        usage="scene",
    )
    ref = service.store_asset(
        owner_id=9,
        product_id=product["id"],
        filename="style.pdf",
        media_type="application/pdf",
        data=b"reference",
        usage="reference",
    )
    project = service.create_snapshot(
        owner_id=9, product_id=product["id"], name="Ad", asset_ids=[asset["id"], ref["id"]]
    )
    workspace = _Workspace()
    result = await service.prepare_render(project=project, workspace=workspace)
    assert result["rendered"] is False
    assert f"{result['workspace_path']}/assets/{asset['id']}-clip.mp4" in workspace.files
    script = json.loads(workspace.files[f"{result['workspace_path']}/script.json"])
    assert len([scene for scene in script["scenes"] if "asset" in scene]) == 1
    assert f"{result['workspace_path']}/assets/{ref['id']}-style.pdf" not in workspace.files


@pytest.mark.asyncio
async def test_failed_asset_upload_does_not_publish_script(
    repo: ProductLibraryRepo, tmp_path: Path
) -> None:
    paths = PathLayout(tmp_path / "octop")
    service = ProductLibraryService(paths, repo)
    product = _product(repo, 10, "Lamp")
    asset = service.store_asset(
        owner_id=10,
        product_id=product["id"],
        filename="lamp.png",
        media_type="image/png",
        data=b"image",
        usage="scene",
    )
    project = service.create_snapshot(
        owner_id=10, product_id=product["id"], name="Launch", asset_ids=[asset["id"]]
    )
    job_path = f"render-jobs/{project['id']}"
    workspace = _Workspace(fail_on=f"{job_path}/assets/{asset['id']}-lamp.png")
    with pytest.raises(OSError):
        await service.prepare_render(project=project, workspace=workspace)
    assert f"{job_path}/script.json" not in workspace.files
