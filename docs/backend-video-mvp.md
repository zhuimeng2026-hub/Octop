# Backend video MVP (independent from desktop M1)

Branch: `feat/backend-video-mvp-20261024`

Existing authenticated product library now exposes:

- `POST /product-library/projects/{project_id}/video-plan` returns a deterministic, Remotion-compatible script and selected snapshot assets.
- `POST /product-library/projects/{project_id}/planned-package` packages that script, approved snapshot media and local Remotion Studio launchers into a ZIP.

Both endpoints enforce the existing owner-scoped `get_project(user.id, project_id)` lookup.

Example request:
```json
{
  "instructions": "Highlight capacity and leather texture",
  "format": "portrait",
  "language": "en",
  "seconds_per_asset": 4,
  "include_selling_points": true
}
```

`format` supports portrait (1080x1920), landscape (1920x1080) and square (1080x1080); scenes use only snapshot media and are validated against canonical export filenames.

## Scope and limitations

This backend-first slice is **not yet a real LLM planner**: `generator=template-v1` identifies its deterministic strategy. `instructions` and `language` are accepted as briefing metadata but do **not** change generated copy yet. The draft is returned by the preview API and zipped by the package API; no editable persistent draft model/database migration is introduced.

The next backend increment should implement an injected low-cost LLM provider, schema validation and a project-scoped draft persistence mechanism, while keeping the same final Remotion `script` contract. Do not claim the user brief is applied until that is implemented.

Focused test: `uv run pytest -q tests/unit/db/test_video_planner_mvp.py`.

No local Octop server, desktop installer or video editor is required by these APIs.
