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
| **Remote** | ~20 MB | Connects to a deployed Octop server. No Python runtime on your machine — install and go. |
| **Slim (local)** | ~20 MB | Runs the full runtime locally. The **first launch** downloads ~215 MB of runtime from the CDN and unpacks it locally; offline afterwards. |

Windows / macOS / Linux installers are listed per release.

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

The complete offline installer (runtime embedded) is still published, but only on
the GitHub Release.

## Documentation

- Guides: <https://github.com/TencentCloud/Octop/tree/main/docs>
- API reference: <https://github.com/TencentCloud/Octop/blob/main/docs/api.md>

## License

MIT — see the source repository.
