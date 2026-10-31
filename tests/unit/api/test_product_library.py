"""Product-library HTTP adapters must preserve user and workspace boundaries."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.product_library import ProductLibraryRepo
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.product_library.service import ProductLibraryService
from octop.infra.product_library.video_planner import VideoPlanRequest
from octop.infra.utils.paths import PathLayout


@pytest.fixture
def library(tmp_path: Path) -> SimpleNamespace:
    db = SqlitePool(tmp_path / "control.db")
    run_migrations(db)
    repo = ProductLibraryRepo(db)
    paths = PathLayout(tmp_path / "data")
    service = ProductLibraryService(paths, repo)
    product = repo.create_product(1, {"name": "Camera"})
    asset = service.store_asset(
        owner_id=1,
        product_id=product["id"],
        filename="说明.txt",
        media_type="text/plain",
        data=b"Confirmed product information",
        usage="reference",
    )
    project = service.create_snapshot(
        owner_id=1,
        product_id=product["id"],
        name="Introduction",
        asset_ids=[asset["id"]],
    )
    server = SimpleNamespace(
        services=SimpleNamespace(paths=paths, product_library_repo=repo),
    )
    return SimpleNamespace(server=server, repo=repo, asset=asset, project=project)


@pytest.mark.asyncio
async def test_asset_download_is_owner_scoped_and_has_safe_headers(
    library: SimpleNamespace,
) -> None:
    from octop.api.routers import product_library

    response = await product_library.download_asset(
        library.asset["id"], user=SimpleNamespace(id=1), server=library.server
    )
    assert Path(response.path).read_bytes() == b"Confirmed product information"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-disposition"].startswith("attachment;")
    assert "filename*=UTF-8''" in response.headers["content-disposition"]

    with pytest.raises(OctopError) as denied:
        await product_library.download_asset(
            library.asset["id"], user=SimpleNamespace(id=2), server=library.server
        )
    assert denied.value.code is ErrorCode.NOT_FOUND


@pytest.mark.asyncio
async def test_other_user_project_cannot_resolve_a_workspace(
    library: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    from octop.api.routers import product_library

    workspace_lookup = AsyncMock()
    monkeypatch.setattr(product_library, "require_running_workspace", workspace_lookup)
    with pytest.raises(OctopError) as denied:
        await product_library.prepare_render(
            library.project["id"],
            product_library.PrepareRenderBody(agent_id="foreign-agent"),
            user=SimpleNamespace(id=2, is_admin=False),
            server=library.server,
        )
    assert denied.value.code is ErrorCode.NOT_FOUND
    workspace_lookup.assert_not_awaited()


@pytest.mark.asyncio
async def test_shared_agent_cannot_receive_another_users_product_materials(
    library: SimpleNamespace,
) -> None:
    from octop.api.routers import product_library

    registry = MagicMock()
    registry.get_row.return_value = SimpleNamespace(agent_id="shared-agent", user_id=2, is_shared=1)
    library.server.app_runtime = SimpleNamespace(agent_registry=registry)
    with pytest.raises(OctopError) as denied:
        await product_library.prepare_render(
            library.project["id"],
            product_library.PrepareRenderBody(agent_id="shared-agent"),
            user=SimpleNamespace(id=1, is_admin=False),
            server=library.server,
        )
    assert denied.value.code is ErrorCode.FORBIDDEN
    registry.get_agent.assert_not_called()


@pytest.mark.asyncio
async def test_other_user_cannot_export_package(
    library: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    from octop.api.routers import product_library

    exporter = MagicMock()
    monkeypatch.setattr(product_library, "export_project_package", exporter)
    with pytest.raises(OctopError) as denied:
        await product_library.download_project_package(
            library.project["id"], user=SimpleNamespace(id=2), server=library.server
        )
    assert denied.value.code is ErrorCode.NOT_FOUND
    exporter.assert_not_called()


@pytest.mark.asyncio
async def test_delete_project_drops_record_and_draft_but_keeps_product_assets(
    library: SimpleNamespace,
) -> None:
    from octop.api.routers import product_library
    from octop.infra.product_library.video_drafts import draft_path

    draft = draft_path(library.server.services.paths.root, 1, library.project["id"])
    draft.parent.mkdir(parents=True, exist_ok=True)
    draft.write_text("{}", encoding="utf-8")

    await product_library.delete_project(
        library.project["id"], user=SimpleNamespace(id=1), server=library.server
    )

    assert library.repo.get_project(1, library.project["id"]) is None
    assert not draft.exists()
    remaining = [row["id"] for row in library.repo.list_assets(1, library.project["product_id"])]
    assert remaining == [library.asset["id"]]


@pytest.mark.asyncio
async def test_other_user_cannot_delete_a_project(library: SimpleNamespace) -> None:
    from octop.api.routers import product_library

    with pytest.raises(OctopError) as denied:
        await product_library.delete_project(
            library.project["id"], user=SimpleNamespace(id=2), server=library.server
        )
    assert denied.value.code is ErrorCode.NOT_FOUND
    assert library.repo.get_project(1, library.project["id"]) is not None


@pytest.mark.asyncio
async def test_package_download_needs_no_workspace_and_cleans_temporary_file(
    library: SimpleNamespace, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from octop.api.routers import product_library

    package = tmp_path / "package.zip"
    package.write_bytes(b"package bytes")
    exporter = MagicMock(return_value=package)
    workspace_lookup = AsyncMock()
    monkeypatch.setattr(product_library, "export_project_package", exporter)
    monkeypatch.setattr(product_library, "require_running_workspace", workspace_lookup)
    response = await product_library.download_project_package(
        library.project["id"], user=SimpleNamespace(id=1), server=library.server
    )
    assert Path(response.path).read_bytes() == b"package bytes"
    assert response.media_type == "application/zip"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "attachment;" in response.headers["content-disposition"]
    exporter.assert_called_once()
    workspace_lookup.assert_not_awaited()
    assert response.background is not None
    await response.background()
    assert not package.exists()


@pytest.mark.asyncio
async def test_regenerating_a_storyboard_keeps_the_audio_settings(
    library: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Regenerating the picture must not silently drop the narration choice."""
    from octop.api.routers import product_library
    from octop.infra.product_library.video_drafts import draft_path, load_draft

    plan_request = VideoPlanRequest()
    script = {
        "title": "Camera",
        "fps": 30,
        "width": 1080,
        "height": 1920,
        "scenes": [{"id": "s1", "type": "title", "duration": 3, "text": "Camera"}],
    }
    root = library.server.services.paths.root
    draft_file = draft_path(root, 1, library.project["id"])
    draft_file.parent.mkdir(parents=True, exist_ok=True)
    draft_file.write_text(
        json.dumps(
            {
                "project_id": library.project["id"],
                "request": plan_request.model_dump(),
                "script": script,
                "confirmed": False,
                "narration_enabled": True,
                "narration_voice": "female-shaonv",
                "bgm_id": "634",
            }
        ),
        encoding="utf-8",
    )

    async def _plan(_snapshot, _request):
        return {"generator": "llm", "script": script}

    monkeypatch.setattr(product_library, "generate_model_plan", _plan)
    result = await product_library.generate_storyboard(
        library.project["id"],
        plan_request,
        user=SimpleNamespace(id=1),
        server=library.server,
    )
    assert result["draft"]["narration_enabled"] is True
    assert result["draft"]["narration_voice"] == "female-shaonv"
    assert result["draft"]["bgm_id"] == "634"

    stored = load_draft(root, 1, library.project["id"])
    assert stored is not None
    assert stored["narration_enabled"] is True
    assert stored["narration_voice"] == "female-shaonv"
