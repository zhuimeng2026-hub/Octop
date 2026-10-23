"""`octop run` must exit cleanly when a shutdown signal arrives."""

from __future__ import annotations

import pytest
from click.testing import CliRunner

from octop import launch
from octop.cli.main import cli


def test_run_foreground_blocking_swallows_shutdown_signal(monkeypatch: pytest.MonkeyPatch) -> None:
    """The KeyboardInterrupt from a captured signal must not escape.

    uvicorn re-raises the signal it captured after the graceful shutdown and
    asyncio's runner converts that into a KeyboardInterrupt. Letting it reach
    the CLI made the process exit 1, so a service manager recorded every
    clean stop as a failed unit.
    """

    async def _fake_run_foreground(**kwargs: object) -> None:
        raise KeyboardInterrupt

    monkeypatch.setattr(launch, "run_foreground", _fake_run_foreground)

    # Must return normally instead of propagating the KeyboardInterrupt.
    launch.run_foreground_blocking()


def test_run_command_exits_zero_on_shutdown_signal(monkeypatch: pytest.MonkeyPatch) -> None:
    """`octop run` must exit 0 on a requested stop — non-zero looks like a crash."""

    async def _fake_run_foreground(**kwargs: object) -> None:
        raise KeyboardInterrupt

    monkeypatch.setattr(launch, "run_foreground", _fake_run_foreground)

    result = CliRunner().invoke(cli, ["run"])
    assert result.exit_code == 0, result.output
