# Desktop automatic video MVP — shared implementation contract

Selected visual: `selected-concept.png` (安心制作页). Preserve the current A wizard first four steps; desktop fifth step is 制作视频. No code changes to the independent M1 checkout. Branch: `codex/desktop-auto-video-render`, based on `fix/backend-mvp-v01-integration`.

## Native bridge

The native shell injects `window.octopDesktopVideo = { version: 1, request(action, payload): Promise<result> }` only into its configured Dashboard origin/base path. A native-owned nonce protects the transport; use the existing `_wails.invoke` event transport, not remotely loaded Wails runtime scripts. Native callback errors carry controlled codes, not credentials or arbitrary command output.

Actions:

| action | payload | result |
| --- | --- | --- |
| start | `{ token, projectId }` | `VideoJob` |
| list | `{ token }` | `VideoJob[]` |
| get | `{ token, jobId }` | `VideoJob` |
| cancel | `{ token, jobId }` | `VideoJob` |
| retry | `{ token, jobId }` | `VideoJob` |
| save | `{ token, jobId }` | `{ saved: boolean }` (native Save dialog) |

`VideoJob`: `{ id, projectId, ownerId, name, state, progress, errorCode?, videoUrl?, updatedAt }`.

- `state`: `preparing | downloading | rendering | saving | completed | failed | cancelled | interrupted`.
- `progress`: `number | null`, 0–1 only for a measurable current stage; no fabricated overall percentage.
- `updatedAt`: Unix seconds. `name` derives from validated project/script metadata.
- `videoUrl`: provided only for completed, owner-authorized jobs. Local loopback streaming supports Range and uses an unguessable capability; never arbitrary file access.
- The native layer resolves owner from authenticated server `/api/auth/me`, never trusts a client owner ID or arbitrary download URL. Server base is pinned by the shell; project IDs are validated. Credentials remain in memory, not job files/logs.
- Duplicate start reuses an active or completed matching project/script job. A new confirmed script version is a distinct result. Only one render runs at a time for the MVP; reject a conflicting start with `BUSY` rather than introducing a queue.
- Persist state in a native app-owned, owner-scoped job directory. Restore completed/failed jobs; running jobs interrupted by true app exit become `interrupted`. Hide jobs on logout/account change; authorization is enforced natively too.

Proposed error codes: `AUTH_REQUIRED`, `NOT_FOUND`, `PLAN_NOT_CONFIRMED`, `PLAN_CHANGED`, `BUSY`, `DOWNLOAD_FAILED`, `PACKAGE_INVALID`, `RUNTIME_UNAVAILABLE`, `RENDER_FAILED`, `SAVE_FAILED`, `CANCELLED`, `INTERNAL`. Frontend maps them to zh/en copy.

## Pipeline and trusted runtime

`start → authenticated confirmed draft → fixed storyboard-package endpoint → validated data extraction → local trusted runtime → background render → completed file → native save dialog`.

Read only `script.json`, `manifest.json`, and referenced `assets/` from the server ZIP. Validate manifest/project ID/SHA256/size and reject traversal/symlinks; never execute the ZIP's scripts, launchers or renderer directory. Do not reuse the portable-runtime extractor, which has a different root and symlink contract.

The trusted runtime directory is `video-runtime` beside the desktop executable (development override `OCTOP_DESKTOP_VIDEO_RUNTIME` is allowed). It contains `runtime.json` (`schema: octop-desktop-video-runtime/1`, `templateVersion: 1`), `node.exe` on Windows / `node` elsewhere, `desktop-worker.mjs`, reviewed renderer sources and locked dependencies. The runtime builder prepares this on the build machine; users do not install Node/npm. First browser preparation may run automatically if a supported local browser is unavailable. Windows packaging includes the runtime directory.

Native invocation: `<runtime>/node.exe <runtime>/desktop-worker.mjs --project <job-data-dir> --out <job-dir>/out/final.mp4`. Use native arguments, hidden windows, captured stdout/stderr; no user-provided shell command. The worker only uses its own fixed template.

Worker stdout is JSONL:

- `{ "type": "stage", "stage": "preparing" | "rendering" | "saving" }`
- `{ "type": "progress", "progress": 0.5 }`
- `{ "type": "complete", "output": "...", "bytes": 123, "duration": 10 }`
- `{ "type": "error", "code": "RENDER_FAILED" }` (details may go to internal stderr).

Stdin `cancel\n` requests graceful cancellation; native layer terminates the owned process tree if needed. A job is completed only after successful process exit and verified non-empty MP4, not simply after 100% frames.

## UI behavior

Confirm success triggers native `start` automatically only after the user's explicit 确认并制作. Merely reopening a historical confirmed draft must not start an expensive new job. The native job belongs to the app, so page changes/minimization continue rendering. A global compact status appears when away from the active job page. True exit cancels safely and preserves a retryable interrupted record.

Three user-facing stages: 准备素材 → 制作画面 → 保存视频. Poster is labeled 封面示意 until a real MP4 exists. Completion displays an actual video player plus 保存视频. Allow background navigation, cancel and retry without regenerating AI. Normal desktop UI hides ZIP, command names, Node, npm and Remotion. Ordinary browsers retain the existing manual ZIP path; capability detection must check the versioned bridge, not just `_wails`.

## Checks

Only targeted Go/video-worker/frontend tests, frontend TypeScript/production build, and one short local render smoke test. No full Go/Python/repository suites or six-platform packaging matrix. Desktop installation or GUI behavior is reported only if actually tested.
