# Octop client downloads

Octop is an open-source, self-hosted AI assistant platform: multi-user,
multi-agent, deployed as a single process with no external queue or broker.
This repository distributes the **Octop desktop client** builds.

> The source code is not in this repository. See
> [GitHub](https://github.com/TencentCloud/Octop) /
> [CNB](https://cnb.cool/mengxa.com/Octop) — this repository holds the
> download page and the release artifacts only.

## Which build do I need

| Your situation | Install this |
|---|---|
| You use the Octop server we already deployed | **Remote** (recommended — install and go) |
| You want your own instance, usable offline | Slim (local) |
| You need to produce product videos | After the client, install the **video components** once |

## Desktop client

Every release is listed under [Releases](https://gitee.com/webheat/octop_client/releases).

| Client | Size | What it is |
|---|---|---|
| **Remote (Windows x64)** | ~6 MB | Connects to a deployed Octop server. No Python runtime on your machine — install and go. |
| **Remote (Windows ARM64)** | ~5.5 MB | Same, for Snapdragon X class ARM devices. |
| **Slim, local (Windows x64)** | ~6 MB | Runs the full runtime locally. The **first launch** downloads ~213 MB of runtime and unpacks it locally; offline afterwards. |

The remote build talks to <https://ocbot.aixifs.com/videogen> directly: sign-in,
product library and AI storyboards live on the server, the client only renders
the UI and the video locally.

**This round ships the Windows build only.** macOS and Linux builds are not
published yet; ARM64 gets the remote build only (a few Python dependencies still
lack win_arm64 wheels, so the slim payload cannot be assembled).

## Video components (separate install)

The desktop client does **not** bundle the video rendering environment (Node +
Remotion + browser, ~500 MB unpacked). It is installed once, separately. Not
installing it does not affect sign-in, the product library or storyboard
editing — only local video production.

| Component | Size | Download |
|---|---|---|
| **Video components (Windows x64)** | ~72 MB | [Download](https://gitee.com/webheat/octop_client/releases/download/v1.4.0-gitee.1/Octop-video-components-windows-x64-1.4.0.exe) ｜ [GitHub mirror](https://github.com/zhuimeng2026-hub/Octop/releases/download/v1.4.0-gitee.1/Octop-video-components-windows-x64-1.4.0.exe) |

Install steps:

1. Run the component installer with the defaults (installs to
   `%LOCALAPPDATA%\Octop\video-runtime`, per-user, no admin rights, no PATH changes).
2. Go back to **Produce product video** in the client and click **Re-check**.
3. The client renders a few seconds of test video; once it shows
   "local production ready", you can produce real videos.

The client shows the same download button; you only see "contact your
administrator" when the URL is unavailable.

## Other artifacts

- `octop-*.whl` / `octop-*.tar.gz` — the Python package (`pip install octop`)
- `Octop-fnos-docker-*.fpk` — the Docker edition for fnOS NAS

## Why the split

The full desktop installer embeds the whole Python runtime and starts at
213 MB. Gitee caps a single attachment at 100 MB, so two smaller shapes are
published instead:

- **Remote** for users who already have an Octop server — nothing to install locally;
- **Slim (local)** for users who want their own instance, deferring the runtime
  download to the first launch.

The runtime itself (213 MB) and the complete offline installer exceed the Gitee
limit, so they live on the
[GitHub Release](https://github.com/zhuimeng2026-hub/Octop/releases) and are
linked from here. The video components compress to 72 MB, which fits on Gitee,
so the Gitee direct link is the primary download.

## Documentation

- Guides: <https://github.com/TencentCloud/Octop/tree/main/docs>
- API reference: <https://github.com/TencentCloud/Octop/blob/main/docs/api.md>

## License

MIT — see the source repository.
