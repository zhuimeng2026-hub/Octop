# Octop client downloads

Octop is an open-source, self-hosted AI assistant platform: multi-user,
multi-agent, deployed as a single process with no external queue or broker.
This repository distributes the **Octop desktop client** builds.

> The source code is not in this repository. See
> [GitHub](https://github.com/zhuimeng2026-hub/Octop) /
> [CNB](https://cnb.cool/mengxa.com/Octop); the upstream project lives at
> [TencentCloud/Octop](https://github.com/TencentCloud/Octop).
> This repository holds the download page and the release artifacts only.

## Two steps and you are rendering

1. **Install the client** (Windows, ~6 MB)
2. **Install the video components** (~71 MB) — video renders locally, without
   this you cannot export a clip

The client connects to our deployed Octop server: sign-in, the product library,
AI storyboards and plan approval all live on the server. The client only
handles the UI and local rendering — **no Python runtime needed on your machine**.

These builds are **not code-signed**, so Windows SmartScreen may warn about an
"unknown publisher": choose "More info" → "Run anyway". This round is
**Windows only**; macOS and Linux are not published yet.

## 1. Client

| System | Download | Size |
|---|---|---|
| Windows 10/11 x64 | [Octop-desktop-windows-amd64-{{ASSET_VERSION}}.exe]({{BASE_URL}}/Octop-desktop-windows-amd64-{{ASSET_VERSION}}.exe) | ~6 MB |
| Windows on ARM (Snapdragon and similar) | [Octop-desktop-windows-arm64-{{ASSET_VERSION}}.exe]({{BASE_URL}}/Octop-desktop-windows-arm64-{{ASSET_VERSION}}.exe) | ~5.5 MB |

Every release is listed under [Releases](https://gitee.com/webheat/octop_client/releases).
The remote client connects to <https://ocbot.aixifs.com/videogen>.

## 2. Video components (required)

The desktop client does **not** bundle the video rendering environment
(Node + Remotion + a browser, ~500 MB unpacked), so it has to be installed
separately. Without it, sign-in, the product library and plan editing all
still work — you just cannot render a clip on this machine.

| Component | Size | Download |
|---|---|---|
| **Video components (Windows x64)** | ~71 MB | [Octop-video-components-windows-x64-{{ASSET_VERSION}}.exe]({{BASE_URL}}/Octop-video-components-windows-x64-{{ASSET_VERSION}}.exe) |

Install steps:

1. Run the components installer with **all default options** (it installs into
   `%LOCALAPPDATA%\Octop\video-runtime`, does not touch the system PATH and
   needs no administrator rights).
2. Back in the client, open "Make a product video" and click **Re-check**.
3. The client renders a few seconds of test footage; once it reports
   "local rendering ready" you can export.

The client shows the same download button; it only asks you to contact an
administrator when the URL cannot be resolved.

## 3. Why only the remote client

A single Gitee release asset is capped at 100 MB:

| Build | Size | Where |
|---|---|---|
| Remote client (provided here) | ~6 MB | ✅ this repository |
| Video components | ~71 MB | ✅ this repository |
| Slim local build (bundles the runtime) | 200 MB and up | ❌ over the cap — see the [GitHub Release](https://github.com/zhuimeng2026-hub/Octop/releases) |
| Full offline package | 200–340 MB | ❌ over the cap — same place |

⚠️ The runtime itself (~290 MB) exceeds the asset cap and is only published on
the GitHub Release. **The runtime URL is baked into the executable at build
time**: an older client will not pick up a newer runtime, so upgrading means
installing a newer client. The slim build needs network access on first launch.

## 4. Known issues

| Symptom | Cause | What to do |
|---|---|---|
| Windows warns "unknown publisher" | The build is not code-signed | "More info" → "Run anyway" |
| The download asks for a captcha | Gitee anti-leech protection | Fill it in; verify downloads work before bulk distribution |
| The slim build cannot fetch the runtime on first launch | The runtime must be published before the client | Use the GitHub Release; this repository only ships the remote client |
| "Re-check" fails after installing the components | Installed into a different directory | Reinstall with default options and confirm `%LOCALAPPDATA%\Octop\video-runtime` exists |
| The components are needed on an ARM64 system | Only an x64 build of the components is provided | The x64 build runs emulated on Windows on ARM, at a performance cost — measure it |

## Documentation

- Usage and deployment guides: <https://github.com/zhuimeng2026-hub/Octop/tree/main/docs>
- API reference: <https://github.com/zhuimeng2026-hub/Octop/blob/main/docs/api.md>

## License

MIT — see the source repository.
