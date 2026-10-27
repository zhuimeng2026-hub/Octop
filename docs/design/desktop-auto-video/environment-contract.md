# Manual rendering components — final shared contract

User decision: keep the main client very small. Start the remote client first; missing rendering prerequisites lead to manual installation of a separate **Octop 视频制作组件** package. No automatic runtime installation or download by the client. Do not put Node/Remotion/Chromium or Python portable backend into the remote thin installer.

Current branch: fix/backend-mvp-v01-integration. Cheap-model implementation, focused tests/build only; independent M1 checkout untouched. d7a2916a navigation logging and 216742ad login redirect are already ancestors of current HEAD; preserve both.

## Distribution

- Remote Windows main client: build tags production,thin, configured remote URL. Existing local/full mode remains available when remote URL is empty.
- Standalone per-user component installer: trusted Node + locked Remotion + worker/template + headless browser, target `$LOCALAPPDATA/Octop/video-runtime`. Manual install, no global PATH change or administrator permission. No directory picker that could accidentally target unrelated files.
- Runtime discovery: explicit OCTOP_DESKTOP_VIDEO_RUNTIME override; separately installed os.UserCacheDir()/Octop/video-runtime; legacy video-runtime beside executable. Never use arbitrary backend ZIP code or user command strings.
- Component download URL is optional build-time defaultVideoComponentsURL, exposed as bridge environmentInstallerURL. Empty URL means clearly ask user to get the component installer from their administrator. Do not invent a released asset or pretend an unconfigured download works.

## Bridge / worker

Keep bridge version1 and environmentVersion1 capability. Authenticated actions: environment_check, environment_verify, environment_status; payload only token. Check/verify run asynchronously and deduplicate. No environment_prepare automatic installation action.

Status: {state: unknown|checking|needs_setup|verifying|ready|failed, stage: components|browser|render_test|null, progress:number|null, errorCode?, checkedAt?:UnixSeconds, requiresInstall?:boolean}. Preserve existing bool field compatibility only if needed; missing runtime requires installing components, never reinstalling the thin client.

Trusted worker args: --check --cache <native-owned-cache>, or --verify --cache <native-owned-cache>. Native cache is octopHome()/desktop-video-environment. JSONL stdout emits {type:environment,...status}. Check never downloads or installs. Missing components/browser => needs_setup. Verify performs a short real MP4 test using already-installed trusted components and browser; no implicit ensureBrowser download. Ready only after successful validation and nonempty MP4. Store a fingerprinted ready stamp in writable cache and invalidate when component/browser changes.

Normal renders use the same selected installed browser/cache. Never write caches/downloads into Program Files. Block concurrent verify/render if necessary, stop owned worker on exit, bound checks/timeouts, no raw paths/logs/credentials in ordinary frontend. No LLM/project/ZIP server generation during environment detection.

Error codes: RUNTIME_MISSING, BROWSER_MISSING, ENV_DISK_FULL, ENV_BROWSER_FAILED, ENV_RENDER_FAILED, ENV_CHECK_FAILED plus existing AUTH_REQUIRED/BUSY/INTERNAL. Map codes to zh/en copy. Missing components cannot be fixed by retry alone.

## UI

New environmentVersion1 clients: first wizard visit checks silently. Missing card: **需要安装视频制作组件**; manual steps 获取独立安装包 → 运行安装程序 → 回到 Octop 重新检测. Configured URL gives a real external 下载制作组件 button; otherwise say 请联系管理员获取安装包. Never execute installer automatically.

Installed/unverified: 验证制作环境. Checking/verifying progress is honest per stage. Ready indicator and 重新检测. Users can edit requirements/scenes during checks; native confirm/start/retry waits for ready with an explicit reason. Opening history or completing validation never auto-starts a video. Older bridge/browser keeps existing behavior.

## Ownership and verification

Native agent owns desktop/src Go and tests, including thin embed tags. Worker agent owns remotion and Windows packaging/standalone component installer. Frontend agent owns dashboard/provider/panel/locales/focused tests. Root reviews/integrates, builds standalone artifact if tools allow, runs real setup validation using an isolated cache, verifies UI, commits/pushes target.

No repository/Go-module full test suites. No global developer-machine software installation. Do not retry prior automatically rejected GUI launch through another tool. Report build/runtime/UI-fixture/installed-clean-machine evidence separately.
