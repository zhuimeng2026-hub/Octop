"""Authenticated product library and Remotion project preparation endpoints."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from octop.api.common.content_disposition import content_disposition
from octop.api.common.upload_limit import read_upload_capped
from octop.api.common.workspace import require_running_workspace
from octop.api.deps import current_user, get_server
from octop.config import DEFAULT_MAX_UPLOAD_MB, upload_mb_to_bytes
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.product_library.package_export import export_project_package
from octop.infra.product_library.service import (
    ProductLibraryService,
    project_payload,
)

router = APIRouter()


@router.get(
    "/product-library/projects/{project_id}/package",
    response_class=FileResponse,
    summary="Download a complete local Studio package",
    description="Download the current user's project, referenced media, and Studio launcher. No running agent or local business backend is required.",
)
async def download_project_package(
    project_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> FileResponse:
    project = _service(server).get_project(user.id, project_id)
    package = await asyncio.to_thread(export_project_package, server.services.paths, project)
    return FileResponse(
        package,
        media_type="application/zip",
        filename=f"video-project-{project_id}.zip",
        background=BackgroundTask(package.unlink, missing_ok=True),
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


class ProductBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    model: str = Field(default="", max_length=200)
    category: str = Field(default="", max_length=100)
    selling_points: list[str] = Field(default_factory=list)
    parameters: dict[str, Any] = Field(default_factory=dict)
    expression_limits: str = Field(default="", max_length=4000)


class ProjectBody(BaseModel):
    product_id: str
    name: str = Field(min_length=1, max_length=200)
    asset_ids: list[str] = Field(default_factory=list)


class PrepareRenderBody(BaseModel):
    agent_id: str


class AssetBody(BaseModel):
    usage: Literal["scene", "reference", "style"] | None = None
    priority: bool | None = None
    active: bool | None = None


class ProductResponse(ProductBody):
    id: str
    owner_user_id: int
    created_at: int
    updated_at: int


class AssetResponse(BaseModel):
    id: str
    product_id: str
    filename: str
    media_type: str
    byte_size: int
    content_hash: str
    usage: str
    priority: int
    active: int
    created_at: int


class ProjectResponse(BaseModel):
    id: str
    product_id: str
    name: str
    snapshot: dict[str, Any]
    created_at: int


class ProductItemsResponse(BaseModel):
    items: list[ProductResponse]


class AssetItemsResponse(BaseModel):
    items: list[AssetResponse]


class ProjectItemsResponse(BaseModel):
    items: list[ProjectResponse]


class PreparedResponse(BaseModel):
    status: str
    job_id: str
    workspace_path: str
    rendered: bool


def _not_found() -> OctopError:
    return OctopError.localized(ErrorCode.NOT_FOUND)


def _service(server: Any) -> ProductLibraryService:
    return ProductLibraryService(server.services.paths, server.services.product_library_repo)


@router.get(
    "/product-library/products", response_model=ProductItemsResponse, summary="List my products"
)
async def list_products(
    user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> dict[str, Any]:
    return {"items": _service(server).list_products(user.id)}


@router.post(
    "/product-library/products",
    status_code=201,
    response_model=ProductResponse,
    summary="Create a product",
)
async def create_product(
    body: ProductBody, user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> dict[str, Any]:
    return _service(server).create_product(user.id, body.model_dump())


@router.patch(
    "/product-library/products/{product_id}",
    response_model=ProductResponse,
    summary="Update a product",
)
async def update_product(
    product_id: str,
    body: ProductBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    return _service(server).update_product(user.id, product_id, body.model_dump())


@router.delete(
    "/product-library/products/{product_id}", status_code=204, summary="Delete a product"
)
async def delete_product(
    product_id: str, user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> None:
    _service(server).delete_product(user.id, product_id)


@router.get(
    "/product-library/products/{product_id}/assets",
    response_model=AssetItemsResponse,
    summary="List product assets",
)
async def list_assets(
    product_id: str, user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> dict[str, Any]:
    return {"items": _service(server).list_assets(user.id, product_id)}


@router.post(
    "/product-library/products/{product_id}/assets",
    status_code=201,
    response_model=AssetItemsResponse,
    summary="Upload product assets",
)
async def upload_assets(
    product_id: str,
    files: list[UploadFile] = File(...),
    usage: Literal["scene", "reference", "style"] = Form(default="reference"),
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    service = _service(server)
    max_bytes = int(
        server.services.config.max_upload_bytes or upload_mb_to_bytes(DEFAULT_MAX_UPLOAD_MB)
    )
    stored = []
    for file in files:
        filename = Path(file.filename or "upload.bin").name
        data = await read_upload_capped(file, max_bytes=max_bytes)
        stored.append(
            await asyncio.to_thread(
                service.store_asset,
                owner_id=user.id,
                product_id=product_id,
                filename=filename,
                media_type=file.content_type or "",
                data=data,
                usage=usage,
            )
        )
    return {"items": stored}


@router.patch(
    "/product-library/assets/{asset_id}",
    response_model=AssetResponse,
    summary="Update asset usage and priority",
)
async def update_asset(
    asset_id: str,
    body: AssetBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    return _service(server).update_asset(
        user.id, asset_id, usage=body.usage, priority=body.priority, active=body.active
    )


@router.get("/product-library/assets/{asset_id}/download", summary="Download product asset")
async def download_asset(
    asset_id: str, user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> FileResponse:
    row = _service(server).get_asset(user.id, asset_id)
    path = server.services.paths.product_library_dir / row["storage_path"]
    if not await asyncio.to_thread(path.is_file):
        raise _not_found()
    disposition = "inline" if row["media_type"].startswith("image/") else "attachment"
    return FileResponse(
        path,
        media_type=row["media_type"],
        headers={
            "Content-Disposition": content_disposition(row["filename"], disposition=disposition),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post(
    "/product-library/projects",
    status_code=201,
    response_model=ProjectResponse,
    summary="Create an immutable video project snapshot",
)
async def create_project(
    body: ProjectBody, user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> dict[str, Any]:
    row = _service(server).create_snapshot(
        owner_id=user.id, product_id=body.product_id, name=body.name, asset_ids=body.asset_ids
    )
    return project_payload(row)


@router.get(
    "/product-library/projects",
    response_model=ProjectItemsResponse,
    summary="List my video projects",
)
async def list_projects(
    user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> dict[str, Any]:
    return {"items": _service(server).list_projects(user.id)}


@router.post(
    "/product-library/projects/{project_id}/prepare-render",
    response_model=PreparedResponse,
    summary="Prepare snapshot in an owned agent workspace",
)
async def prepare_render(
    project_id: str,
    body: PrepareRenderBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    row = _service(server).get_project(user.id, project_id)
    ws = await require_running_workspace(
        body.agent_id, user=user, as_user=None, server=server, owner_only=True
    )
    return await _service(server).prepare_render(project=row, workspace=ws)
