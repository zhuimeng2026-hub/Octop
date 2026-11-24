"""Persistence and immutable snapshot behavior for the product library."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.product_library import ProductLibraryRepo
from octop.infra.errors import ErrorCode, OctopError
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


def test_snapshot_fails_whole_project_when_a_selected_asset_is_archived(
    repo: ProductLibraryRepo, tmp_path: Path
) -> None:
    """A7.3 #25 / A8.1: archived selection fails the whole snapshot, no partial write."""
    service = ProductLibraryService(PathLayout(tmp_path / "octop"), repo)
    product = _product(repo, 7, "Archived case")
    side = service.store_asset(
        owner_id=7,
        product_id=product["id"],
        filename="side.jpg",
        media_type="image/jpeg",
        data=b"side",
        usage="scene",
    )
    front = service.store_asset(
        owner_id=7,
        product_id=product["id"],
        filename="front.jpg",
        media_type="image/jpeg",
        data=b"front",
        usage="scene",
    )
    repo.update_asset(7, side["id"], active=False)

    with pytest.raises(OctopError) as caught:
        service.create_snapshot(
            owner_id=7,
            product_id=product["id"],
            name="Rejected",
            asset_ids=[side["id"], front["id"]],
        )
    err = caught.value
    assert err.code is ErrorCode.PRODUCT_LIBRARY_ASSET_INACTIVE
    assert err.status == 409
    assert err.details["assets"] == "side.jpg"
    assert repo.list_projects(7) == []


def test_snapshot_still_returns_not_found_for_another_users_archived_asset(
    repo: ProductLibraryRepo, tmp_path: Path
) -> None:
    """A8.1 invariant: others' / missing assets stay 404, never disclosed as inactive."""
    service = ProductLibraryService(PathLayout(tmp_path / "octop"), repo)
    product = _product(repo, 8, "Owner")
    mine = service.store_asset(
        owner_id=8,
        product_id=product["id"],
        filename="mine.jpg",
        media_type="image/jpeg",
        data=b"mine",
        usage="scene",
    )
    foreign_product = _product(repo, 9, "Foreign")
    foreign = service.store_asset(
        owner_id=9,
        product_id=foreign_product["id"],
        filename="foreign.jpg",
        media_type="image/jpeg",
        data=b"foreign",
        usage="scene",
    )
    repo.update_asset(9, foreign["id"], active=False)

    with pytest.raises(OctopError) as caught:
        service.create_snapshot(
            owner_id=8,
            product_id=product["id"],
            name="Foreign selected",
            asset_ids=[mine["id"], foreign["id"]],
        )
    assert caught.value.code is ErrorCode.NOT_FOUND
    assert caught.value.status == 404


def test_snapshot_accepts_scene_assets_from_multiple_products(
    repo: ProductLibraryRepo, tmp_path: Path
) -> None:
    service = ProductLibraryService(PathLayout(tmp_path / "octop"), repo)
    first_product = _product(repo, 5, "First")
    second_product = _product(repo, 5, "Second")
    first = service.store_asset(
        owner_id=5,
        product_id=first_product["id"],
        filename="first.png",
        media_type="image/png",
        data=b"first",
        usage="scene",
    )
    second = service.store_asset(
        owner_id=5,
        product_id=second_product["id"],
        filename="second.png",
        media_type="image/png",
        data=b"second",
        usage="scene",
    )

    project = service.create_snapshot(
        owner_id=5,
        product_id=first_product["id"],
        name="Combined",
        asset_ids=[first["id"], second["id"]],
    )

    snapshot = json.loads(project["snapshot_json"])
    assert {asset["id"] for asset in snapshot["assets"]} == {first["id"], second["id"]}
    assert {asset["product_id"] for asset in snapshot["assets"]} == {
        first_product["id"],
        second_product["id"],
    }


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
