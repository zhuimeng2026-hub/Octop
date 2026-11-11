# Octop client downloads

Octop is an open-source, self-hosted AI assistant platform: multi-user,
multi-agent, deployed as a single process with no external queue or broker.
This repository distributes the **Octop desktop client** builds.

> The source code is not in this repository. See
> [GitHub](https://github.com/TencentCloud/Octop) /
> [CNB](https://cnb.cool/mengxa.com/Octop) — this repository holds the
> download page and the release artifacts only.

## Download

Every release is listed under [Releases](https://gitee.com/webheat/octop_client/releases).

### Desktop client

| Client | Size | What it is |
|---|---|---|
| **Remote** | ~18 MB | Connects to a deployed Octop server. No Python runtime on your machine — install and go. |
| **Slim (local)** | ~20 MB | Runs the full runtime locally. The **first launch** downloads ~290 MB of runtime from the GitHub Release and unpacks it locally; offline afterwards. |

**This round ships the Windows build only** (64-bit / ARM64). macOS and Linux
builds are not published yet.

### Other artifacts

- `octop-*.whl` / `octop-*.tar.gz` — the Python package (`pip install octop`)
- `Octop-fnos-docker-*.fpk` — the Docker edition for fnOS NAS

## Why two clients

The full desktop installer embeds the whole Python runtime and lands at
200–340 MB. Gitee caps a single attachment at 100 MB, so two smaller shapes are
published instead:

- **Remote** for users who already have an Octop server;
- **Slim (local)** for users who want their own instance, deferring the runtime
  download to the first launch.

The runtime itself (~290 MB) and the complete offline installer exceed the Gitee
attachment limit, so they live on the
[GitHub Release](https://github.com/zhuimeng2026-hub/Octop/releases) and are
linked from here.

## Documentation

- Guides: <https://github.com/TencentCloud/Octop/tree/main/docs>
- API reference: <https://github.com/TencentCloud/Octop/blob/main/docs/api.md>

## License

MIT — see the source repository.
