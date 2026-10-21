# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

> `AGENTS.md` at the repo root is the canonical agent handbook (module boundaries, hard bans, i18n/timezone rules, change workflow, branching). It is imported above — read it before making changes. This file only adds what is verified locally and not repeated there.

## What this is

Octop — self-hosted AI assistant platform (multi-user, multi-agent), shipped as **one Python wheel**: FastAPI backend + React dashboard + Click CLI, glued over three reusable libs (`octop-harness` = LangGraph runtime, `octop-gateway` = IM channel pipeline, `octop-memory`). Single process: no worker, no external queue, no required service beyond an LLM provider.

## Commands

`make` is the project's entry point (`Makefile`, `SHELL := /bin/bash`), but **`make` is not installed on this host** (`mingw32-make` exists in `C:\mingw64\bin` but the Makefile assumes a POSIX bash env). Run the underlying commands directly; keep the Makefile as the source of truth for CI.

```bash
# install (creates .venv on first run)
uv sync

# tests — always `uv run pytest`, never bare `pytest`
uv run pytest -m "not live"                              # full suite (ship bar)
uv run pytest tests/unit -x -q                           # unit only, stop on first failure
uv run pytest tests/integration -x -q                    # integration only
uv run pytest tests/unit/db/test_db_pool.py::test_x -q   # single test
uv run pytest -k "test_db_pool and not postgres"         # select by name
uv run pytest -m "not live and not slow"                 # skip slow
uv run pytest -m live                                    # real LLM/external calls
uv run pytest -m postgresql                              # needs OCTOP_TEST_DATABASE_URL

# lint / format / types
uv run ruff check src tests
uv run ruff format src tests
uv run mypy src/octop            # --strict, files = src/octop (see pyproject [tool.mypy])

# frontend (dashboard/ — React 18 + TS + Vite)
cd dashboard && npm ci
cd dashboard && npx tsc -b        # typecheck
cd dashboard && npm run lint      # eslint
cd dashboard && npm run format    # prettier write
cd dashboard && npm test          # vitest
cd dashboard && npm run build     # → src/octop/dashboard/  (never edit that dir by hand)

# git hooks (once per clone)
git config core.hooksPath .githooks
```

pytest markers: `live` (hits real LLM/external), `slow` (expensive: integration boot, real harness, browser), `postgresql` (needs `OCTOP_TEST_DATABASE_URL`). `asyncio_mode = "auto"` — async tests need no decorator.

## Architecture quick map

Layering and hard bans are defined in `AGENTS.md` §5; the short version — dependencies flow inward, transport (HTTP/CLI) → domain (`infra/`) → leaf helpers, and never the reverse:

| Path | Role |
|---|---|
| `src/octop/infra/server.py` | `OctopServer.start()` — the composition root; wires repos, agents, gateway, cron, plugins, experts |
| `src/octop/launch.py` | The **only** module allowed to import both `infra/server` and `api/app`; serves uvicorn |
| `src/octop/api/` | FastAPI: `app.py` (factory), `deps.py` (JWT → `current_user`, `get_server`), `middleware/`, `routers/` (~60 routers, one per resource) |
| `src/octop/infra/` | Domain: `agents/`, `gateway/`, `db/`, `history/`, `cron/`, `skills/`, `connectors/`, `users/`, `auth/`, `setup/`, `knowledge/`, `backend/`, `bridge/`, `voice/`, `proactive/`, `mobile/`, `browser/`, `agent_mcp/`, `errors.py`, `metrics.py` |
| `src/octop/cli/` | Click commands: `commands/`, `support/` (offline / embedded / bridge / external transports), `repl/` |
| `src/octop/i18n/` | `en.json` / `zh.json` bundles + `domains/*.py` helpers (`tr()`, `error_message()`, `tool_display_name()`) |
| `dashboard/src/` | React app: `api/` → `pages/` → `components/`, `hooks/`, `context/`, `locales/` |

**Dependency injection:** routers get `server: OctopServer = Depends(get_server)`; every repo is reached through `server.services` (`SharedServices` from `infra/db/services.py`). Never import a repo at module level outside `SharedServices` / `RepoBundle`.

**Database:** SQLite (WAL) or PostgreSQL, one shared schema. Migrations are numbered pairs `src/octop/infra/db/migrations/00N_desc.sql` + `00N_desc.pg.sql`; the latest pair is **`021_skill_package_download`**, and the version assertion in `tests/unit/db/test_db_pool.py` is currently **`v == 21`** (keep the two in sync when you add a migration). Resource tables use an integer surrogate `id` PK plus a public string `{entity}_id` (ULID) that APIs and child FKs use.

**Agent scope:** most agent routes nest under `/api/agents/{agent_id}/…`; a few legacy ones (MBTI) still use the `X-Octop-Agent-Id` header. Always load the agent row and check ownership via `_assert_agent_owner(row, user)` (admin bypass).

**Workspace file I/O** goes exclusively through `HarnessAgent.workspace` (`BackendWorkspace` from octop-harness) with workspace-relative paths — never `Path.write_text` under `~/.octop/agents/<id>/`, never `agent.backend` directly, never branch on backend type in Octop.

## Conventions that are easy to get wrong

- **i18n** — any user-facing string produced by the *server* comes from `src/octop/i18n/*.json` (locales `zh` + `en`, `en` is the fallback), never hard-coded English in `infra/`. `ErrorCode` values map to `errors.<CODE>`; the dashboard mirrors them under `apiErrors.*` and `tests/unit/i18n/` enforces key parity on both sides.
- **Timezone** — all user-facing datetimes and cron defaults use `config.json → default_timezone` (`OCTOP_DEFAULT_TIMEZONE` overrides), not the browser's zone. Dashboard reads it via `GET /api/settings/timezone` and formats with `formatServerDateTime` / `formatMessageTime(..., timeZone)`. Never call bare `toLocaleString()` for a timestamp a user sees.
- **Paths** — `.` (workspace dir) and `/` (backend root) are distinct inside `BackendWorkspace`; HTTP adapters normalize dashboard paths via `workspace_api_path()`.
- **Slash commands** — routed in `infra/gateway/slash/dispatcher.py`, implemented in `slash/handlers/`, catalogued in `slash/catalog.py`; replies are localized through `octop.i18n.domains.slash`.
- **Async** — no blocking I/O in async functions; use `run_in_executor`.
- **Cross-platform** — CI runs Linux *and* Windows. Never hard-code POSIX paths in assertions; use `tmp_path` / `pathlib.Path` equality, `tests.support.fakes.fake_bin_path()`, and `pytest.mark.skipif(os.name != "posix")` for POSIX-only behavior.

## Also in this repo (not covered by AGENTS.md)

| Path | What it is |
|---|---|
| `docs/architecture.md` | Human-readable overview of the process model and runtime tree (AGENTS.md is the agent-facing twin) |
| `docs/api.md`, `docs/cli.md`, `docs/adr/`, `docs/*.md` | Human API/CLI reference, ADRs, per-feature guides (LDAP, ACP, bridge, connectors, personas, teams) |
| `plugins/` | Example plugin packages (`demo-toolkit`, `bilibili-anime`, `server-status`, …) — plugin authoring reference |
| `desktop/` | Wails v3 desktop client shell + portable packaging (distinct from `infra/desktop/`, which is remote-screen streaming) |
| `fnos/` | fnOS (飞牛) `.fpk` packaging and install scripts |
| `scripts/` | Install scripts, CI helpers, release link generation |
| `.cursor/skills/publish/SKILL.md` | Agent-facing release/publish flow — read it before tagging or publishing |
| `.githooks/pre-commit` | Local commit gate: `make all` + dashboard build (bypass: `SKIP_PRECOMMIT=1`) |
| `src/octop/dashboard/` | **Build artifact** — edit `dashboard/` and rebuild, never this directory |

## Where to look first

- How is a message processed → `infra/gateway/processor.py`
- How agents start/stop → `infra/agents/manager.py`
- How cron works → `infra/cron/manager.py`, `infra/cron/job.py`
- Auth → `api/deps.py`, `api/middleware/jwt_auth.py`, `api/routers/auth.py`
- DB tables → `src/octop/infra/db/migrations/` + `src/octop/infra/db/repos/`
- Tests & fixtures → `tests/support/` (`fakes`, `auth`, `http`, `scenarios`, `app`), `tests/unit/{db,cron,gateway,agents,api,cli}/`
