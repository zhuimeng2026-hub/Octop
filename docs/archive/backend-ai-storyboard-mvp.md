# Backend AI video storyboard MVP

> **状态：已归档（2026-11-26）。** 本文是服务端 LLM 分镜 MVP 的快照，已被现行接口与产品文档取代。
> 现行口径见 [API 参考](../api.md)、[视频生产工作台 PRD](../design/video-production-workbench/PRD.md)
> 与 [Web 五步向导规范](../design/product-video-wizard/README.md)。

Independent from desktop M1. Existing authenticated products/projects and Remotion ZIP exporter are reused.

## Endpoints
- `POST /product-library/projects/{id}/generate-storyboard` — low-cost OpenAI-compatible model creates a validated script and saves a draft.
- `GET /product-library/projects/{id}/storyboard` — read owned draft.
- `PUT /product-library/projects/{id}/storyboard` — edit a script, validate it and optionally mark it `confirmed`.
- `GET /product-library/projects/{id}/storyboard-package` — export the **confirmed** storyboard as a Remotion Studio ZIP.

All routes first call owner-scoped `get_project(user.id, project_id)`. Drafts are atomically stored per owner in `OCTOP_HOME/product-library/video-drafts`. Include this directory in backups.

## Model configuration (server environment only)
- `OCTOP_VIDEO_LLM_API_KEY` = key (never store in frontend)
- `OCTOP_VIDEO_LLM_BASE_URL` = HTTPS OpenAI-compatible base URL (normally ending in `/v1`)
- `OCTOP_VIDEO_LLM_MODEL` = your chosen inexpensive text model

There is no hard-coded provider or billable default. Model failure returns an API error and never silently labels a template as AI content. A single model request has a 35-second timeout and 512 KB response limit. The generated JSON undergoes strict scene/asset/type/length/duration validation before it can be saved or exported.

## MVP limitations
- No document extraction, visual image understanding, automatic voiceover, or rich timeline editing yet.
- This is one saved draft per project, not version history or collaborative editing.
- Drafts use filesystem storage, not shared PostgreSQL storage; multi-instance/cloud deployments require a shared storage plan before rollout.
- No production provider credentials have been configured or tested.
- Targeted test: `uv run pytest -q tests/unit/db/test_video_storyboard_drafts.py`.
