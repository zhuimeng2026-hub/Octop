"""Product-library HTTP adapters must preserve user and workspace boundaries."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.product_library import ProductLibraryRepo
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.product_library.service import ProductLibraryService
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
