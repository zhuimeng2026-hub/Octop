# AGENTS.md

Navigation guide for AI coding agents working in this repository.

## 1. Collaboration principles

> Favor caution over speed; trivial tasks may relax these rules. These principles complement [§10 Change workflow](#10-change-workflow) and [§11 Communication](#11-communication).

### Think before writing

- State assumptions up front; ask when unsure — do not guess.
- When multiple interpretations exist, list them and let the user choose — do not pick silently.
- Suggest simpler approaches when they exist; push back when appropriate.
- Stop when blocked; name exactly what is unclear.
- Name the owning repository before editing (see [Runtime libraries](#runtime-libraries)).

### Simplicity first

- Write the minimum code that solves the problem; no unrequested features, abstractions, or config knobs.
- Do not add defensive error handling for scenarios that cannot realistically happen.
- Trim the diff when it grows unnecessarily large.

### Surgical edits

- Touch only lines directly related to the task; do not opportunistically "clean up" nearby code, comments, or formatting.
- Do not refactor working code or unify style just because it differs from yours.
- Unrelated dead code: mention it, do not delete it proactively.
- Remove orphan imports, variables, and functions **you** introduced.

### Verifiable outcomes

- Turn tasks into verifiable goals (what to test, which command proves success).
- For multi-step work, sketch a short plan: `step → verify: …`
- Before saying "done", report the focused local checks and their results. CI owns the full release gate (see [§6 Run commands](#6-run-commands), [§10 Change workflow](#10-change-workflow)).

### Local verification is a smoke test, not the full suite

> **Run only the smallest local smoke check that verifies the change.** This is the project
> default for every task. CI runs the configured checks: the dashboard job builds and tests;
> Linux and Windows Python jobs run lint, typecheck, and `make test`; the same-repository,
> non-release-sync live job starts for eligible PRs, while individual live tests skip when
> credentials are absent. Desktop M1 checks are path-filtered
> focused tests plus desktop packaging/build checks. Commit hooks follow §6.

| Change | Local verification (allowed) | Not allowed locally |
|---|---|---|
| Backend (`src/octop/**`) | Import the module, boot the service, call the 1–2 endpoints the change touches, run the **single** test file that covers it | `uv run pytest` (whole suite) |
| Frontend (`dashboard/**`) | `npx tsc -b`, build the touched page, run the **one** test file | `npm test` (whole suite) |
| Desktop (`desktop/**`) | `go build ./...`, `go vet ./...`, run the **changed** package's tests | `go test ./...` (all packages) |
| Migrations | Apply against a scratch DB, check the version watermark | Migrating a shared database |

- If a change spans several areas, run **one focused command per area** — never the union.
- Say plainly in the summary which commands you ran and what they proved.
- If a change is broad enough that a smoke test cannot prove it, **say so** and let CI decide —
  do not quietly expand into a full local run.

## 2. What this is

**Octop** — self-hosted AI assistant platform (multi-user, multi-agent).
One Python wheel: FastAPI backend + React dashboard + Click CLI.
No external queue. No required services beyond an LLM provider.

> **Frontend / backend deployment boundary (read before any build or deploy).** The
> repo is one monorepo, but `dashboard/` (frontend source) and `src/octop/` (backend)
> are **two separate deployment units**. The **only** thing crossing the boundary is
> the build artifact `src/octop/dashboard/` (gitignored, never committed). **The
> backend environment NEVER builds the frontend** — no `npm`/`vite`/`make build-frontend`
> on a server or in a backend-only session. Seeing `dashboard/` source change from a
> backend context is a **NO-OP + report**, not a build trigger. Full if-then rules:
> `docs/deployment-boundary.md`.

### Runtime libraries

Octop hosts four libraries. Put the change in the library that owns the behavior. This repo only wires users, the control-plane database, HTTP, CLI, dashboard, and cron.

| Change | Repository |
|--------|------------|
| Agent loop, tools, skills, backends, middleware; turn wiring for memory and `browser_use` | [octop-harness](https://github.com/TencentCloud/octop-harness) |
| IM platform protocol, media upload, group activation | [octop-gateway](https://github.com/TencentCloud/octop-gateway) |
| Memory capture, recall, ranking, schema, storage | [octop-memory](https://github.com/TencentCloud/octop-memory) |
| Chrome CDP, profiles, DOM, `browser_tool` | [octop-browser](https://github.com/TencentCloud/octop-browser) |
| Users, auth, threads, cron, experts, dashboard | this repo |

Do not copy that behavior into `src/octop/`. Follow the library's `AGENTS.md`. When the library releases, bump its pin in `pyproject.toml`.

## 3. Tech stack

| Layer | Technology |
|-------|-----------|
| Language | Python 3.12+ |
| Web framework | FastAPI + uvicorn |
| Async runtime | asyncio (no threads except `run_in_executor`) |
| Database | SQLite via sync `sqlite3` (WAL) **or** PostgreSQL via `psycopg` / `psycopg_pool` |
| Agent runtime | `octop-harness` |
| IM channels | `octop-gateway` |
| Memory | `octop-memory` |
| Browser | `octop-browser` |
| Frontend | React 18 + TypeScript + Vite |
| Package manager | uv — always `uv run pytest`, never bare `pytest` |
| API docs UI | Scalar (`scalar-fastapi`) at `/api/docs` |

## 4. Package layout

High-level tree — see [§5 Module boundaries](#5-module-boundaries) for what each folder owns and what it may import.

```
Octop (`octop/` workspace directory)     Python package root (`src/octop/`)
  config.py
  launch.py                   composition root: OctopServer + FastAPI + uvicorn
  i18n/                       locale JSON bundles + tr() + domain helpers
  infra/                      domain core (agents, DB, gateway, …)
  api/                        HTTP adapters (FastAPI)
  cli/                        Click commands
  dashboard/                  built SPA artifact — do NOT edit

dashboard/                    frontend source (Vite) — edit here
docs/                         human-written reference (e.g. `api.md`)
tests/                        pytest (`unit/`, `integration/`)
```

## 5. Module boundaries

**Rule of thumb:** dependencies flow **inward** — transport layers call domain; domain never calls HTTP/CLI. Within `infra/`, leaf modules (`utils/`, `db/repos/`, `errors.py`) stay free of higher-level orchestration. Library behavior stays in that library (see [Runtime libraries](#runtime-libraries)).

### Layer overview

```
dashboard/ ──HTTP──► api/ ──► infra/ ──► infra/utils/, octop.config
cli/ ──► launch.py ──► api/ + infra/
```

| Layer | Role | May import | Must NOT import |
|-------|------|------------|-----------------|
| `octop.config` | Env-based `OctopConfig` | stdlib, pydantic | `infra/`, `api/`, `cli/`, `launch.py` |
| `octop.i18n` | Locale JSON + `tr()` + per-namespace helpers | `infra/utils/locale`, stdlib | `api/`, `cli/`, `dashboard/` |
| `octop.launch` | Wire `OctopServer`, `build_app`, uvicorn for `octop run` | `infra/`, `api/` | business logic; must not be imported by `infra/` |
| `infra/utils/` | Pure helpers (paths, ulid, env files, Ollama) | stdlib, third-party | any other `infra/*` domain code |
| `infra/db/repos/` | One repo per table — SQL only | `infra/db/_base`, `infra/utils/` | `agents/`, `gateway/`, `api/`, orchestration |
| `infra/` (domain) | Business logic & orchestration | `infra/utils/`, `infra/db/`, `octop.config`, peer `infra/*` subpackages, `infra/errors`, `infra/metrics` | `api/`, `cli/`, `launch.py`, `dashboard/` |
| `api/` | HTTP: routing, auth, SSE, OpenAPI | `infra/`, `octop.config`, sibling `api/*` | `cli/`, `launch.py`; no business rules that belong in `infra/` |
| `cli/` | Terminal UX | `infra/`, `octop.config`, `launch.py`, sibling `cli/*` | `api/`; domain logic duplicated from `infra/` |
| `dashboard/` | React UI | `dashboard/src/api` → backend over HTTP | Python packages; no direct DB or `infra/` access |

**Hard bans**

- `infra/` → `api/`, `cli/`, or `launch.py`.
- `api/` → `cli/` or `launch.py`.
- `cli/` → `api/` (use `launch.py` for `octop run` instead).
- `infra/db/repos/` → any non-DB `infra` package.
- `infra/utils/` → any non-utils `infra` package.
- Routers/helpers in `api/routers/` must stay thin: validate HTTP, call `infra/`, map errors — not new domain rules.

### `infra/` subpackages

| Path | Owns | Typical importers |
|------|------|-------------------|
| `infra/agents/` | Agent registry (`manager.py`), harness runtime, providers, settings (`settings/`), workspace paths (`workspace/`), threads helpers (`threads/`), security, persona/MBTI, experts, plugins, teams, memory | `server.py`, `gateway/`, `api/routers/agents.py` |
| `infra/backend/` | Workspace storage adapter, resolver, remote probe (COS/S3/…) | `agents/`, `api/routers/workspace*.py` |
| `infra/connectors/` | Connector catalog, OAuth, MCP gateway, credential crypto | `api/routers/connectors.py`, `internal_mcp.py`, `agents/manager.py` (MCP assembly) |
| `infra/control/` | Host control surfaces: `browser/`, `desktop/`, `mobile/` | `api/routers/browser/`, `desktop/`, `mobile/` |
| `infra/cron/` | Cron jobs, triggers, agent tool hooks | `server.py`, `api/routers/cron.py` |
| `infra/db/` | `SqlitePool`, migrations, `RepoBundle` / `SharedServices` in `services.py` | all domain code needing persistence |
| `infra/gateway/` | IM ingress (`processor.py`), threads, slash commands (`slash/`), bot setup (`bot_creators/`) | `server.py`, `api/routers/chat.py`, `channels.py` |
| `infra/history/` | Versioned message archive, trajectory, turn projection (`projection.py`) | `gateway/`, `api/routers/chat`, `cron/`, `agents/teams` |
| `infra/setup/` | First-run wizard, system service install, TLS / Let's Encrypt | `server.py`, `launch.py`, `api/routers/setup.py`, `api/routers/tls.py` |
| `infra/skills/` | Skill packages, SkillHub HTTP client (`skillhub_market`, `skillhub_common`) | `api/routers/skills.py`, `agents/experts` |
| `infra/users/` | Users, roles, password hashing, `UserManager` | `server.py`, `api/routers/auth.py`, `users.py` |
| `infra/errors.py` | `OctopError`, `ErrorCode` — shared exception types | everywhere in `infra/` and `api/` |
| `infra/metrics.py` | In-process counters (`METRICS`) | lazy-import inside hot paths |
| `infra/server.py` | `OctopServer.start()` — wires infra singletons | `launch.py`, `api/app.py` |

### `launch.py`

| Path | Owns | Must NOT |
|------|------|----------|
| `launch.py` | `run_foreground` / `run_foreground_blocking` — boot `OctopServer`, serve via uvicorn + `build_app`, clean shutdown | HTTP routes, SQL, CLI argument parsing |

Only `launch.py` may import both `infra/server` and `api/app` in the same module.

### `api/` layout

| Path | Owns | Must NOT own |
|------|------|--------------|
| `api/app.py` | FastAPI factory, router registration, static dashboard mount | domain rules, SQL |
| `api/deps.py` | JWT extraction, `current_user`, `get_server` | agent lifecycle, cron logic |
| `api/middleware/` | JWT gate, setup lockdown | business validation beyond auth/setup |
| `api/openapi_meta.py` | Scalar tags, API intro text | route handlers |
| `api/errors.py` | Map `OctopError` → HTTP status + JSON | new error semantics (add to `infra/errors.py`) |
| `api/routers/` | One resource per module; Pydantic request/response models | persistence, harness calls — delegate to `infra/` |
| `api/routers/browser/` | Browser session/stream HTTP surface | CDP, profiles, and DOM stay in `octop-browser`; this router is glue |

### `cli/` layout

| Path | Owns |
|------|------|
| `cli/main.py` | Click entry, command registration |
| `cli/*_cmd.py` | User-facing subcommands |
| `cli/support/db.py` | Offline DB (`open_cli_services`) |
| `cli/support/offline_ops.py` | Local CRUD via repos (thin wrappers) |
| `cli/support/embedded_ops.py` | Short-lived `OctopServer` for runtime ops |
| `cli/support/acting.py` | Resolve `--user` / pinned defaults / agent owner |
| `cli/support/ctx.py` | Root `--user` / `--agent` / `--json` resolution |
| `cli/support/state.py` | Pinned `default_user` / `default_agent` in `cli_state.json` |
| `cli/run_cmd.py` | `octop run` — delegates to `launch.run_foreground_blocking` |
| `cli/init_cmd.py`, `cli/backup_cmd.py` | Local DB bootstrap / backup via `infra/db` |

**CLI transport layers** (pick one per command; domain rules live in `infra/`, not duplicated in `cli/`):

| Layer | When | Examples |
|-------|------|----------|
| **Offline** | Read/write local `~/.octop` SQLite only | `user *`, `provider *`, `cron` list/create/delete, `agent list/delete`, `chats` CRUD, `models` presets/list/active, `channel` CRUD, `admin`, `skills` enable/disable, `bridge` list/get |
| **Embedded** | Needs harness/gateway runtime; boots in-process `OctopServer` | `chats send/repl`, `chats get` (history), `cron run-now`, `agent` create/start/stop/reload, `provider test`, `channel test`, `skills list`, `acp` |
| **Embedded (bridge)** | In-process `BridgeManager` (no full server); CLI cannot keep Bridge WS after exit | `bridge` probe/create/patch/delete/connect/disconnect/agents |
| **External** | Talks to OS/daemon directly, no Octop HTTP | `models ollama-*`, channel QR bind (WeCom/WeChat), Feishu bot-creator subprocess |

No `octop user login` — CLI trusts local filesystem access to `~/.octop`. Pin acting user with `octop config set-user` or root `--user`; pin agent with `octop agent use` or root `--agent`. If `octop run` is already running, config CLI writes take effect after server restart (cron, channels loaded at boot).

### `dashboard/src/` layout

| Path | Owns | Must NOT |
|------|------|----------|
| `api/` | Typed fetch wrappers (`request.ts`, `modules/*`) | UI components, page state |
| `pages/` | Route-level screens and page-local hooks | generic reusable widgets (move to `components/`) |
| `components/` | Shared UI building blocks | direct `fetch` (use `api/` modules) |
| `hooks/` | Reusable React hooks | page-specific one-off logic |
| `context/` | App-wide React context (agent, auth, …) | API calls without going through `api/` |
| `layouts/`, `routes/` | Shell, sidebar, route table | business logic |
| `locales/` | i18n strings | — |
| `utils/` | Frontend pure helpers | API or server knowledge |

Frontend talks to Octop **only** via `/api` HTTP — never import or assume Python module layout.

## 6. Run commands

```bash
make install-hooks                      # once per clone: enable .githooks pre-commit
make all                                # format-all + lint + typecheck + test (ship bar)
make format-all                         # backend Ruff + dashboard Prettier write
make lint                               # ruff check + format check
make typecheck                          # mypy --strict src/octop
make format                             # ruff auto-fix + format (backend only)
make format-frontend                    # prettier write (dashboard only)
uv run pytest -m "not live"            # full test suite (no LLM calls)
uv run pytest tests/unit -x -q        # unit tests only, stop on first fail
uv run pytest tests/integration -x -q # integration tests only
cd dashboard && npx tsc -b             # [frontend-env only] frontend typecheck (after UI changes)
make build-frontend                     # [frontend-env only] dashboard/ → src/octop/dashboard/
bash scripts/deploy-dashboard.sh        # [frontend-env only] sync built artifact → server
```

> ⚠️ **The commands above are the CI gate's repertoire, not the local routine.**
> Locally run **only the focused commands for the code you touched** — a single test file,
> a single package, a typecheck, a build. See
> [Local verification is a smoke test, not the full suite](#local-verification-is-a-smoke-test-not-the-full-suite).
> `make all` and the whole-suite pytest are **not** local steps; CI owns the full release gate.

**Git hooks (required for local commits):** after cloning, run **`make install-hooks`** once. That sets `core.hooksPath=.githooks` so each commit runs `.githooks/pre-commit`: backend `make format`, `make lint`, `make typecheck`, and `make test-smoke`; staged dashboard changes additionally run frontend formatting and `npm run build`, unless `SKIP_FRONTEND=1` is set. A commit containing only root `README.md` / `README.*.md` changes skips these checks. After backend formatting, only the original staged ACMR paths that still exist are re-staged before the frontend formatter runs; dashboard-only formatting is not implied. Bypass only in emergencies: `SKIP_PRECOMMIT=1 git commit …` or `git commit --no-verify`. Do **not** skip hooks to land red tests — fix the suite first (CI runs on Linux **and** Windows).

## 7. Key patterns

**DI:** Routers receive `server: OctopServer = Depends(get_server)`; core services live on `server.services` (`SharedServices` from `infra/db/services.py`). Never import repos at module level outside `SharedServices` / `RepoBundle`.

**Agent scope:** Most agent routes use `/api/agents/{agent_id}/…` in the URL. A few legacy endpoints (e.g. MBTI) still take `X-Octop-Agent-Id`. Always validate ownership: load the agent row → `_assert_agent_owner(row, user)` (or admin bypass).

**Agent workspace I/O:** All reads/writes of agent workspace **content files** go through `HarnessAgent.workspace` (`BackendWorkspace` from `octop-harness`). Do **not** use `agent.backend` directly, `resolve_harness_backend`, or `Path.write_text` / `read_text` on `~/.octop/agents/<id>/` for workspace content. Do **not** branch on backend type or `virtual_mode` in Octop — path rules live in `BackendWorkspace`.

New agents additionally keep system-scoped files under `{workspace}/.octop/` (e.g. sessions/sqlite, skills/agents system trees, auth tokens under `.octop/auth`). `system_files_path` is internal and not user-configurable; the `.octop` directory is created on first harness workspace init. Legacy agents keep auth at `{workspace}/.octop-auth`.

| Context | Entry |
|---------|--------|
| HTTP (agent must be running) | `require_running_workspace()` in `api/common/workspace.py` |
| Gateway / IM / media | `harness_workspace_for_agent()` in `infra/gateway/process/agent_resolve.py` |
| Agent startup seed (SOUL, expert, plugins) | `agent.workspace` after `_start_agent` |

**Path conventions:** Pass workspace-relative paths to `BackendWorkspace` (`SOUL.md`, `skills/foo/SKILL.md`). Directory listing defaults to `"."` (current workspace directory). `"/"` is a distinct backend-root path inside `BackendWorkspace` — do **not** conflate it with `"."` there. The dashboard may send leading-`/` paths; HTTP adapters normalize those in `workspace_api_path()` before calling `BackendWorkspace`.

**Chat attachments:** Dashboard uploads go to `{workspace}/inbound/` via `api/common/attachments.py` + `api/routers/uploads.py`, not a separate `~/.octop/uploads/` store.

**Mount prefix:** `config.json` → `base_path` (env `OCTOP_BASE_PATH`) mounts the whole app under a URL path prefix (e.g. `/videogen`); the dashboard must be built with the same prefix (`BASE_URL=/videogen npm run build` in `dashboard/`). See `docs/configuration.md`.

**Database:** SQLite and PostgreSQL share one schema. Add or change tables via a numbered pair
`infra/db/migrations/00N_description.sql` **and** `00N_description.pg.sql`. The version assertion in
`tests/unit/db/test_db_pool.py` compares against `MAX_SCHEMA_VERSION`, which is derived from the
migrations directory — adding the pair is enough, there is no manual bump to keep in sync.
Rebuilds that SQLite cannot express as `ALTER` live in `infra/db/migrate.py` helpers and must stay idempotent.

Unreleased schema work on `develop` **folds into the current unreleased `00N`**, not a new
`00N+1`. Only cut a new number after that version has shipped (or after a local DB at `N` would
otherwise skip the change). `_schema_version` is an applied-migration watermark, not a changelog
of every edit. The numbered SQL pair is the canonical v(N-1)→vN DDL (including table rebuilds);
`migrate.py` helpers must stay equivalent and idempotent for SQLite `ADD COLUMN` and for
databases whose recorded version skipped the file. Do not re-apply a RENAME rebuild just to
clamp `_schema_version`.

Resource tables (API-visible entities: `agents`, `channels`, `threads`, `cron_jobs`,
`knowledge_bases`, `knowledge_documents`, `skill_packages`, `published_experts`, …) use:

| Column | Role |
|--------|------|
| `id` | Integer surrogate PK (`AUTOINCREMENT` / `GENERATED BY DEFAULT AS IDENTITY`) |
| `{entity}_id` | Public string UNIQUE (ULID / short id). APIs, paths, and other tables use this |

Child rows store the **string** id (`knowledge_base_id` or a short alias such as `kb_id`,
`agent_id`, `thread_id`) and `REFERENCES parent({entity}_id)`. Never FK the integer `id`.
Repos map `row.id` to the public string; keep the integer as `row.pk` when both are needed.

Do **not** force this onto: `users` (integer `user_id` FKs; login identity is `username`);
name-keyed config (`providers`, `voice_providers`, `storage_backends`); append-only logs
(`usage_log`, `audit_log`, `care_push_records`); KV (`settings`, `secrets`); 1:1 extensions
(`proactive_care_config` keyed by `agent_id`); ephemeral rows (`sso_login_states`).

**Slash commands:** `infra/gateway/slash/dispatcher.py` routes; `handlers/` implements; catalog in `catalog.py`.

**Internationalization (i18n):** Supported locales are **`zh`** and **`en`** (`en` is the fallback). User-facing text produced by the **server** (slash replies, IM/channel status, API error messages, tool display names, CLI output) must come from backend bundles — not hard-coded English in `infra/` when the string is shown to end users.

Backend layout (`src/octop/i18n/`):

```
i18n/
  loader.py            load JSON, lookup(), tr() — dot-path resolve + format
  en.json, zh.json     canonical bundles; keep key trees identical across locales
  domains/             one module per top-level JSON namespace
    errors.py          errors.* → error_message()
    tools.py           tools.* → tool_display_name(), all_tool_labels()
    channel.py         channel.* → channel_tool_hint_start/end()
    slash.py           slash.* → tr() with short keys, field_label, localized_rows
```

**Lookup rules**

- Use full paths with `from octop.i18n import tr`, e.g. `tr("slash.catalog.help.label", locale)`.
- Prefer `octop.i18n.domains.<ns>` (or re-exports on `octop.i18n`) for repeated namespaces — e.g. `tool_display_name()`, `error_message()`.
- Slash handlers use `from octop.i18n.domains.slash import tr` (short keys like `"help.title"`).
- Interpolation uses Python `str.format` placeholders (`{name}`, `{tool_name}`).

**Locale resolution** (`infra/utils/locale.py`): stored user preference wins, then `Accept-Language` (dashboard sends this on API calls), then channel-type hints (IM platforms default `zh`, `telegram` → `en`). Use `resolve_user_locale()` in gateway/IM paths; `resolve_request_locale()` in HTTP handlers.

**API errors:** `ErrorCode` values map to `errors.<CODE>` in JSON. `OctopError.to_envelope(locale=…)` and the global exception handler localize `message`. Dashboard mirrors codes under `apiErrors.*` in `dashboard/src/locales/{en,zh}.json` — tests require backend and frontend keys to match.

**IM channels:** Tool names and hint lines must be localized in `stream_project.py` — pass localized `tool_name` and pre-formatted `tool_hint_text` on `MessageEvent.tool_start/end` (octop-gateway reads `tool_hint_text` when present). Do not rely on English `ChannelConstraints.tool_hint_template` alone.

**Frontend split**

- **Dashboard chrome** (nav, forms, buttons): `dashboard/src/locales/{en,zh}.json` via i18next.
- **Server-owned copy** (tools, apiErrors): canonical in `src/octop/i18n/*.json`; dashboard keeps copies synced (see `tests/unit/i18n/`) and may hydrate tools from `GET /api/i18n/tools`.

**Adding strings (checklist)**

1. Add the same key to `en.json` and `zh.json` under the right namespace (`slash`, `errors`, `tools`, `channel`, …).
2. Add or extend a `domains/*.py` helper when the namespace is used in multiple call sites.
3. If the key is an `ErrorCode` or `apiErrors` entry, update both backend `errors` and dashboard `apiErrors`.
4. Run `uv run pytest tests/unit/i18n -q` (key parity + domain helpers).

Do **not** use gettext (`.po` files). Do **not** embed user-visible English in `infra/` when a backend i18n key exists. Expert catalog (`infra/agents/experts/`) still uses embedded `label_zh`/`label_en` in source data — out of scope unless explicitly migrating that catalog.

**Timezone (config.json):**

User-facing datetime display and cron/scheduling defaults MUST use the server timezone from `config.json` → `default_timezone` (env override `OCTOP_DEFAULT_TIMEZONE`; legacy `cron_timezone` / `OCTOP_CRON_TIMEZONE` still accepted) — not the browser's local timezone.

| Layer | Entry |
|-------|--------|
| Config | `OctopConfig.default_timezone` in `config.py` |
| API | `GET /api/settings/timezone` → `{ "timezone": "…" }` (`GET /api/cron/settings` remains a compat alias) |
| Dashboard | `useServerTimezone()`; format with `formatServerDateTime` / `formatServerIsoDateTime` / `formatMessageTime(..., timeZone)` in `dashboard/src/utils/formatMessageTime.ts` |

**Do not** use bare `toLocaleString()` / `toLocaleDateString()` / `toLocaleTimeString()` for timestamps users see without passing the server `timeZone`. Number grouping via `Number#toLocaleString()` (e.g. download counts) is fine.

**Language:** Keep the existing locale resolution (user preference → `Accept-Language` / dashboard i18n → channel hints → `DEFAULT_LOCALE`). Language is **not** a `config.json` key — do not add one unless explicitly requested.

**Workspace storage:** `infra/backend/resolver.py` resolves harness `BackendProtocol` from agent config; remote backends use `probe.py` for fast tree listing. Docker sandbox (`type: "docker"` / storage `kind=docker`) uses `sandbox_scope` + `sandbox_prefix` (Octop default `octop_sandbox`) — see `docs/agent-backend-file-io.md` §13.

**Connectors:** `infra/connectors/` — catalog, OAuth registry, MCP gateway; HTTP surface in `api/routers/connectors.py`.

**Metrics:** `from octop.infra.metrics import METRICS` — lazy-import inside functions to avoid circular imports.

**API docs:** Interactive docs live at `/api/docs` (Scalar, backed by `/api/openapi.json`). When adding or changing API routes, keep the generated docs readable for humans:

- Use existing `tags` from `api/openapi_meta.py`; add a tag description there when introducing a new group.
- Give every route a short `summary`; use `description` for non-obvious behavior (auth, streaming, side effects).
- Prefer typed `response_model` and Pydantic request bodies over raw `dict`.
- Document non-obvious fields with `Field(..., description="…")`; name models clearly.
- Spot-check `/api/docs` after API changes — a route that renders as an empty card or untyped blob is unfinished.

**Cross-platform tests:** Octop CI runs on both Linux and Windows, so tests must not assume a single platform:

- Guard POSIX-only behavior with the repo convention `@pytest.mark.skipif(os.name != "posix", reason="…")`; prefer a module-level `posix_only = pytest.mark.skipif(os.name != "posix", reason="…")` alias. Use `pytest.mark.skipif(os.name == "nt", reason="…")` when a case is Linux/macOS-only for a different reason (e.g. forbidden path characters).
- Do not hard-code POSIX paths (`/`, `/proc`, `/etc`, `/root`, `/usr/bin/…`, `~` → HOME) in assertions that run on every platform — they resolve differently on Windows (e.g. `/` → `D:\`). Prefer opaque mock tokens via `tests.support.fakes.fake_bin_path("tool")` (uses `pathlib` / `os.sep`) when stubbing `shutil.which` / `resolve_binary`.
- Prefer `tmp_path` / `tmp_path_factory` and `pathlib.Path` over OS-specific literals; compare paths with `Path` equality (`tmp_path / "a" / "b"`), not string prefixes with `/`. Use `Path.as_posix()` / `os.sep` only when a serialized path string is part of the contract under test.
- Do not assert `chmod` mode bits, symlink semantics, or Unix-only subprocess shells unless the test is marked `posix_only` (and production code short-circuits on non-POSIX the same way).
- When a feature's semantics are inherently POSIX-only (e.g. the host root_dir denied prefixes in `infra/utils/host_dirs.py`), keep the source guards (`os.name != "posix"` short-circuit) and mirror them in the tests.
- New connector/CLI/gateway tests that materialize files under `OCTOP_HOME` must set `monkeypatch.setenv("OCTOP_HOME", str(tmp_path))` and assert dirs with `Path` joins — never assume `~/.octop/...` string shape.

## 8. Do not

Boundary rules are in [§5](#5-module-boundaries). Additionally:

- Do not reimplement `octop-harness`, `octop-gateway`, `octop-memory`, or `octop-browser` under `src/octop/` (see [Runtime libraries](#runtime-libraries)).
- Do not import legacy top-level modules — use current paths:
  - `octop.agents.*` → `octop.infra.agents.*`
  - `octop.channels.*` → `octop.infra.gateway.*`
  - `octop.db.*` → `octop.infra.db.*`
  - `octop.users.*` → `octop.infra.users.*`
  - `octop.utils.*` → `octop.infra.utils.*` (or `octop.infra.metrics` for metrics)
  - `octop.errors` / `octop.server` / `octop.shared` → `octop.infra.errors` / `octop.infra.server` / `octop.infra.db.services`
- Do not import `api/` from `infra/` or `cli/` — use `launch.py` to wire HTTP serving.
- Do not put domain logic in `api/routers/` or `cli/*_cmd.py` when it belongs in `infra/`.
- Do not import `infra/db/repos/*` from routers — use `server.services.*_repo` via `infra/` services or managers.
- Do not write bare `pytest` — always `uv run pytest`.
- Do not edit `src/octop/dashboard/` directly — build artifact; source is `dashboard/`.
- **Never build the frontend from a backend environment or production server** — no `npm` /
  `vite` / `make build-frontend` there (server has no Node and ~2.6G RAM; vite OOMs).
  A `dashboard/` change seen in a backend context is a NO-OP + report, not a build trigger.
  See `docs/deployment-boundary.md` (§2 decision table) — it is authoritative for this boundary.
- Do not add blocking I/O in async functions — use `run_in_executor`.
- **Do not write requirements in ambiguous wording.** `待定` / `二选一` / "either A or B" is not a
  requirement, and an acceptance entry that cannot be decided is not an acceptance entry — see
  [§12.1](#121-normative-keywords-rfc-2119--rfc-8174). Decide with the user, then record the decision.
- Do not merge a change whose touched acceptance entries have no verdict — see
  [§12.3](#123-definition-of-done-dod--before-merge).
- **Do not publish the embedded backend address in user-facing distribution material.** The
  service URL baked into the desktop client (`ocbot.aixifs.com/videogen` and friends) is an
  implementation detail: the client connects to it on its own, so the download page, the
  release notes and the README never need to name it. Say "已部署好的 Octop 服务" /
  "the deployed Octop server" instead. This applies to `scripts/gitee/REPO_README*.md`,
  release bodies, the packaged `README.txt` and any other text a downloader reads.

## 9. Where to look

| Question | Location |
|----------|----------|
| How does auth work? | `api/deps.py`, `api/middleware/jwt_auth.py`, `api/routers/auth.py` |
| LDAP (directory) login | `infra/auth/ldap/`, `api/routers/auth_ldap.py`; config row is `sso_providers.kind='ldap'`; guide: `docs/ldap.md` |
| Setup wizard (password file, tokens) | `infra/setup/`, `api/routers/setup.py` |
| TLS / Let's Encrypt | `infra/setup/tls/`, `api/routers/tls.py` |
| `octop run` boot sequence | `launch.py`, `cli/run_cmd.py` |
| How is a message processed? | `infra/gateway/processor.py` → harness agent |
| How are agents started/stopped? | `infra/agents/manager.py` |
| How does cron work? | `infra/cron/manager.py`, `infra/cron/job.py` |
| What DB tables exist? | `infra/db/migrations/` + `infra/db/repos/` |
| What env vars are supported? | `config.py` |
| How does the frontend call the API? | `dashboard/src/api/request.ts` |
| Internationalization (backend) | `src/octop/i18n/`, `infra/utils/locale.py`, `api/routers/i18n.py` |
| Internationalization (dashboard) | `dashboard/src/locales/`, `dashboard/src/i18n.ts`, `dashboard/src/utils/apiError.ts` |
| Server timezone (config.json) | `default_timezone` in `config.py`; `GET /api/settings/timezone`; `dashboard/src/hooks/useServerTimezone.ts`; `dashboard/src/utils/formatMessageTime.ts` |
| Test layout & shared helpers | `tests/support/` (`fakes`, `auth`, `http`, `scenarios`, `app`), `tests/integration/conftest.py`, `tests/unit/{db,cron,gateway,agents,api,cli}/` |
| Pre-commit hooks | `make install-hooks` → `.githooks/pre-commit` (staged-path backend gate; dashboard format/build only when applicable) |
| What is a Thread? | `infra/gateway/threads.py`, `infra/db/repos/threads.py` |
| Workspace backend resolution | `infra/backend/resolver.py`, `infra/backend/adapter.py` |
| Connectors & OAuth | `infra/connectors/catalog.json` (built-in metadata + i18n), `infra/connectors/`, `api/routers/connectors.py`; human list: `docs/connectors.md` |
| OpenAPI tags and API intro | `api/openapi_meta.py` |
| Human-readable API reference | `docs/api.md` |
| Frontend/backend deployment boundary (which env builds, artifact handoff) | `docs/deployment-boundary.md` (authoritative) |
| Deployment pitfalls (path prefix, proxy, agent-running) | `docs/deployment-pitfalls.md` |
| Windows deployment (PowerShell script, PS 5.1 quirks, SSH key ACL) | `docs/windows-deploy-script.md`; `scripts/deploy-dashboard.ps1` |
| WeChat Open Platform login (开放平台网站应用扫码) | `docs/wechat-open-login.md` |
| SharedServices / RepoBundle | `infra/db/services.py` |
| Branching & release | [§10](#10-change-workflow) Branching & release; `CONTRIBUTING.md`; `.cursor/skills/publish` |
| Requirement wording, DoR / DoD | [§12](#12-requirements-wording-and-delivery-definitions) |
| Eval format, layers, judging rules, CI wiring | `docs/eval/README.md` (normative) |
| Engineering backlog / night-batch work items | `docs/backlog.md` (normative) |
| Human or environment-specific todos | `docs/todo.md` |
| Product requirement docs (PRD) | `docs/PRD.md`; per-topic requirement docs indexed in `docs/README.md` |

## 10. Change workflow

1. **Clarify scope** — read relevant code/docs; confirm assumptions and ambiguities with the user (see [§1](#1-collaboration-principles)). If the behavior belongs to a runtime library, change that repo (see [Runtime libraries](#runtime-libraries)).
2. **Hooks** — if this clone has not run `make install-hooks` yet, do it before committing (see [§6](#6-run-commands)). Pre-commit must stay green for the staged paths; it is not an unconditional full-suite or dashboard build.
3. **Minimal implementation** — change only task-related files. Dashboard source is in `dashboard/`. Produce the static artifact in `src/octop/dashboard/` from a frontend environment when packaging or deployment is part of the task.
4. **Verify** — follow [§1 local verification](#local-verification-is-a-smoke-test-not-the-full-suite). For `dashboard/` changes, choose one relevant smoke check (`cd dashboard && npx tsc -b`, a focused build, or one test file); do not imply all three ran. After API route changes, glance at `/api/docs` for readable summaries and schemas. After i18n JSON changes, run `uv run pytest tests/unit/i18n -q`. CI runs the full release gate, including cross-platform coverage described in [§7](#7-key-patterns).
5. **Wrap up** — remove orphan symbols introduced in this change; do not commit or push unless asked.

**Touching the video production workbench** (`docs/design/video-production-workbench/PRD.md`)? Its §0.1
holds **product** invariants (dual-layer operation, defaults-as-entry, recoverability, real multi-platform
specs) — removing one of those requires the product owner's approval **and** an update to that
PRD's §0.1 change log; do not treat it as a UI cleanup. The **engineering** constraints for the same
area live here:

- The four phases (产品与素材 / 营销方案 / 分镜生产 / 输出交付) are the canonical step model;
  the Web five steps and the desktop five steps are **implementation aliases** — do not invent a
  fifth naming, and do not change the phase model to fix a UI problem.
- Desktop bridge actions, states, error codes and the ZIP safety invariants are defined in
  `docs/design/desktop-video-bridge-contract.md`; read it before touching `desktop/src/video.go`
  or the frontend bridge calls. Changing an action set means updating that contract in the same change.
- Engineering slices for this area are **not** in the PRD — they live in `docs/backlog.md` B-006.
- Local vs remote frontend/backend build boundaries are governed by `docs/deployment-boundary.md`
  (§2 decision table) — a frontend change is a NO-OP + report in a backend environment.

### Branching & release

```
feature/* ──PR──► develop ──► release/x.y.z ──PR──► main ──tag v*──► publish
hotfix/* ──PR──► main (+ tag) and ──PR──► develop
```

| Branch | Role |
|--------|------|
| `main` | Production source of truth; **default branch**; only release / hotfix merges; **only `v*` tags on `main` are production** |
| `develop` | Daily integration; **base for feature PRs** |
| `release/x.y.z` | Temporary freeze (version bump / CHANGELOG / bugfixes); **delete after ship** |

**Rules**

- Never push `develop` directly onto `main` — ship via `release/*` → `main` (or hotfix → `main`) only. Do **not** bulk-merge `develop` → `main`; it forks history and breaks post-release sync.
- Merge `release/*` → `main` with a **merge commit** (not squash) so `main` stays reconcilable with `develop`.
- Release sequence: cut `release/*` from latest `develop` → PR into `main` → **tag `v*` on main tip only after merge** → delete `release/*` → Actions syncs `main` → `develop` (`sync-main-to-develop.yml`; opens `chore/sync-develop-after-*` on conflict / branch protection).
- Keep **`main` an ancestor of `develop`** after every release. Do not use legacy `head=main` → `develop` sync PRs.
- Do **not** push a production tag from a release/feature branch before it is on `main`.
- Hotfix: branch from `main`, PR to `main` (and tag if shipping), then PR into `develop`.
- Day-to-day feature work: branch from `develop`, open PR **into `develop`** (not `main`).
- A worktree with uncommitted in-flight work is snapshotted onto `wip/<topic>` — never merged wholesale into `develop`; replay item by item. Rules and the delete criteria: `docs/wip-branch-workflow.md`.
- Production deployments come from a **`v*` tag on `main`** — never from a WIP snapshot, an unmerged branch, or a dirty worktree. `develop` is the always-present integration branch: after tests pass it flows `release/*` → `main` → `v*` tag, and production checks out that tag.
- Human detail: `CONTRIBUTING.md`. Agent publish flow: `.cursor/skills/publish`.

## 11. Communication

- Default to **Chinese** when talking to the user; cite code with `` `path:line` ``.
- Lead with the conclusion, then details; write complete sentences, not telegraphic fragments.
- When marking work done, include verification commands and results (or explain why they were not run).
- Do not pile on unrelated follow-ups; mention out-of-scope issues briefly, do not expand scope unilaterally.

## 12. Requirements wording and delivery definitions

This section governs **how requirements are written** and **when work counts as ready / done**.
It is binding for agents and humans alike. Format and tooling for evals live in
[`docs/eval/README.md`](docs/eval/README.md) (normative).

### 12.1 Normative keywords (RFC 2119 / RFC 8174)

Requirement statements — PRD entries, acceptance criteria, API descriptions, contract docs —
MUST carry a normative keyword:

| Chinese keyword | RFC 2119 keyword | Meaning | Binding |
|-----------------|------------------|---------|----------|
| 必须 / 不得 | **MUST** / **MUST NOT** | Mandatory; a violation blocks the merge | hard |
| 应当 | **SHOULD** | Default; deviating requires a stated reason in the PR description | soft, must justify |
| 可以 | **MAY** | Optional | none |
| 建议 / 最好 | (non-normative) | A hint, **not** a requirement | none |

Rules:

- A requirement block MUST contain at least one normative keyword. Descriptive prose without a
  keyword is context, not a requirement.
- English keywords MUST be uppercase when normative — per RFC 8174, lowercase `must` / `should`
  carries no requirement force.
- **MUST NOT** leave a behaviour undecided: `待定` / `二选一` / `看情况` / "either A or B" is not a
  requirement. Decide it with the user and record the decision, or split it into two separately
  decidable requirements. (This is exactly why the "二选一" entry in the multi-category PRD was
  un-implementable.)
- Acceptance entries MUST be **decidable**: each maps to one automated case or one reproducible
  manual walkthrough. Wording like "应该好用" is invalid.
- 建议 / MAY-style statements MUST NOT be used as an acceptance basis.
- Applies to **new or edited** requirement entries. Existing requirement documents are
  grandfathered — do not mass-rewrite them, but never introduce new ambiguous wording while editing.

### 12.2 Definition of Ready (DoR) — before implementation starts

A requirement is Ready only when all of the following hold; otherwise it stays a draft:

1. Problem statement + goal — the user problem being solved.
2. Scope **and** explicit non-goals.
3. At least one decidable acceptance entry ([§12.1](#121-normative-keywords-rfc-2119--rfc-8174)).
4. Ownership resolved: the module that owns the behaviour ([§5](#5-module-boundaries)); runtime-library
   behaviour is routed to that repo ([§2](#2-what-this-is)).
5. Backend work: the HTTP shape is decided — summary, request/response models, error codes ([§7](#7-key-patterns)).
6. User-visible strings: zh **and** en strings identified ([§7](#7-key-patterns) i18n).
7. User-visible timestamps: the server-timezone source identified ([§7](#7-key-patterns) timezone).
8. Schema change: the migration pair number assigned ([§7](#7-key-patterns)).
9. Cross-platform behaviour: POSIX / Windows differences stated ([§7](#7-key-patterns)).
10. Open questions closed — no undecided binary choices left in the text. Anything still open is
    registered in the owning doc's 开放问题 table (or `docs/PRD.md` §8) with status 待决 and a
    destination for the decision.
11. The owning requirement doc carries an **实现状态 table** — one row per requirement entry, with the
    status word from `docs/README.md` §文档维护规范 rule 7 (口径已定·实现待做 / 已实现·已验证).
    A requirement whose 实现状态 table does not exist is a draft, not Ready: the table is where
    「口径已定、代码未实施」 items live, so it cannot be omitted without losing the item's only
    landing point.

### 12.3 Definition of Done (DoD) — before merge

1. Every acceptance entry touched by the change has a verdict — pass / fail / n/a with reason —
   recorded in the PR description or the owning requirement doc. A documentation-only change or
   exploratory check must be labelled as such; it does not become a product acceptance result.
   `fail` or `blocked` on a required check MUST NOT be merged as done. `n/a` is valid only when
   the check genuinely does not apply and the reason is recorded; not run is never `pass`.
2. At least one regression case exists for the changed behaviour: an automated test, or an explicit
   documented manual check when automation is not feasible.
3. Local verification stayed a smoke test ([§1](#1-collaboration-principles)); the full suite is CI's job.
4. i18n parity: both `zh` and `en` updated together; `uv run pytest tests/unit/i18n -q` when i18n JSON changed.
5. New or changed routes render readably in `/api/docs` — summary, description, typed models ([§7](#7-key-patterns)).
6. Docs synced: this file, the `docs/README.md` index, and the owning requirement doc's status /
   verification record (`docs/README.md` §文档维护规范). If the work was tracked as a backlog entry,
   that entry's "完成后回写" list is also satisfied — the entry moves to 已完成 with the commit.
7. No orphan imports or symbols introduced; no secrets in code, docs or logs ([§8](#8-do-not)).
8. Behaviour-level changes ship with an eval case per [§12.4](#124-evaluations-evals) — or the PR
   states why an existing automated test already covers it.

### 12.4 Evaluations (evals)

- Eval task format, layers, judging rules and CI wiring: [`docs/eval/README.md`](docs/eval/README.md) — normative.
- Evals cover what unit tests assert badly: multi-step flows, permission boundaries, wording,
  cross-layer regressions, and anything with an LLM in the loop.
- A requirement that changes **agent behaviour** (slash commands, tool calls, gateway messaging,
  model-driven output) MUST ship with at least one eval case, or justify in the PR why the existing
  automated test already covers the behaviour.
- When a requirement's wording is decided but the code is not written yet, the pending work MUST be
  registered where it can be found — the owning doc's implementation-status table plus an eval task
  with `status: planned`, or a `docs/backlog.md` entry — and MUST NOT stay implicit.

### 12.5 Normative document map

Which document governs what, and what wins when two disagree.

| Concern | Authoritative source | Notes |
|---------|----------------------|-------|
| Agent constraints, module boundaries, bans | `AGENTS.md` | highest; overrides habit |
| Requirement wording, DoR, DoD | `AGENTS.md` §12 | binding for the whole change lifecycle |
| Eval format, layers, judging, CI wiring | `docs/eval/README.md` | normative |
| Engineering backlog (P1 = unattended night-batch work) | `docs/backlog.md` | normative; an entry owns its scope / steps / acceptance / stop conditions |
| WIP branch (worktree snapshot) workflow | `docs/wip-branch-workflow.md` | normative; when to snapshot, how to replay, when it may be deleted |
| Human or environment-specific todos | `docs/todo.md` | one landing point per todo — see `docs/README.md` §文档维护规范 rule 7 |
| Document placement, index, single source of truth | `docs/README.md` §文档维护规范 | a new doc must be registered or merged |
| Architecture rationale | `docs/adr/`, `docs/architecture.md` | ADR wins over prose |
| HTTP contract | generated `/api/openapi.json` + `docs/api.md` | generated schema wins on shape |
| Database schema | `src/octop/infra/db/migrations/` | pairs are canonical; see §7 |
| Product requirements (PRD) | `docs/PRD.md` + the per-topic requirement docs indexed in `docs/README.md` | one topic, one document |
| Product steps / phases model | `docs/design/video-production-workbench/PRD.md` §2 | the four phases are canonical; Web / desktop step names are implementation aliases |
| Desktop bridge actions, states, error codes, ZIP safety invariants | `docs/design/desktop-video-bridge-contract.md` | current contract; the 2026-10 design under `docs/archive/` is superseded |
| Document directories (`docs/` root vs `docs/design/` vs `docs/archive/`) | `docs/README.md` §文档维护规范 rules 9–10 | `design/` = 专题设计稿 (must self-declare status); `archive/` = history, never an implementation basis |
| Branching & release | [§10](#10-change-workflow) + `CONTRIBUTING.md` | — |
| Security policy | `SECURITY.md` | — |
| Ownership / mandatory review | `.github/CODEOWNERS` | — |

**Conflict rule**: the document that tracks the code wins on *facts* (schema, endpoints, paths) —
but the conflict MUST be reconciled in the same change. Never leave two documents asserting
different conclusions about the same behaviour.
