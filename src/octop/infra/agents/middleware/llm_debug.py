"""Dump the exact payload that goes to the model provider (opt-in).

Octop never logs the LLM request by default: the request carries the user's
prompt, the agent's system prompt and every tool schema, so writing it to
disk is a deliberate operator decision, not a default.

Enable it per deployment with ``OCTOP_LLM_DEBUG=1``. Each model call is then
appended as one JSON object to ``<OCTOP_HOME>/logs/llm/llm-<YYYY-MM-DD>.jsonl``
with the request (system prompt, messages, tool schemas, model settings) and
the response (content, tool calls, token usage).

Strings are redacted through the harness' PII detector before they are
written, so an API key that the user pasted into the chat does not end up in
the dump verbatim.

The dump is taken at the middleware boundary. The harness appends a few more
middleware after the host-provided ones (tool filtering, tool search), so the
tool list may differ slightly from the final outbound request; the
``segments`` field carries the same token estimate the harness publishes on
the AI message, which makes the difference visible instead of silent.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from collections.abc import Awaitable, Callable
from datetime import datetime
from pathlib import Path
from typing import Any, cast

from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from octop_harness.context_usage import breakdown_from_model_request
from octop_harness.middleware.pii import detect_pii

logger = logging.getLogger(__name__)

_REDACTED = "[redacted]"


def _redact_text(text: str) -> str:
    """Mask API keys, phone numbers and ID numbers inside a dumped string."""
    if not text:
        return text
    try:
        matches = detect_pii(text)
    except Exception:  # noqa: BLE001 - redaction must never break a model call
        logger.exception("PII detection failed; writing the value unredacted")
        return text
    if not matches:
        return text
    pieces: list[str] = []
    cursor = 0
    for match in matches:
        try:
            start = int(match["start"])
            end = int(match["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if start < cursor or end <= start:
            continue
        pieces.append(text[cursor:start])
        pieces.append(_REDACTED)
        cursor = end
    pieces.append(text[cursor:])
    return "".join(pieces)


def _redact_json(value: Any) -> Any:
    """Recursively redact every string inside a JSON-ish structure."""
    if isinstance(value, str):
        return _redact_text(value)
    if isinstance(value, dict):
        return {str(k): _redact_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_redact_json(v) for v in value]
    return value


def _message_payload(message: Any) -> dict[str, Any]:
    """Normalize one LangChain message into a JSON-safe dict."""
    content = getattr(message, "content", None)
    if isinstance(content, (dict, list)):
        content = json.dumps(content, ensure_ascii=False, default=str)
    payload: dict[str, Any] = {
        "role": str(getattr(message, "type", "") or getattr(message, "role", "") or ""),
        "content": _redact_text(str(content or "")),
    }
    name = getattr(message, "name", None)
    if name:
        payload["name"] = str(name)
    tool_call_id = getattr(message, "tool_call_id", None)
    if tool_call_id:
        payload["tool_call_id"] = str(tool_call_id)
    tool_calls = getattr(message, "tool_calls", None)
    if tool_calls:
        payload["tool_calls"] = _redact_json(
            [
                {
                    "name": call.get("name"),
                    "args": call.get("args"),
                    "id": call.get("id"),
                }
                for call in tool_calls
                if isinstance(call, dict)
            ]
        )
    return payload


def _tool_payload(tool: Any) -> dict[str, Any]:
    """Normalize one tool definition (bound schema or LangChain tool)."""
    if isinstance(tool, dict):
        redacted: Any = _redact_json(tool)
        return cast("dict[str, Any]", redacted)
    name = getattr(tool, "name", "") or type(tool).__name__
    description = str(getattr(tool, "description", "") or "")
    parameters: Any = None
    schema = getattr(tool, "args_schema", None)
    getter = getattr(schema, "model_json_schema", None)
    if callable(getter):
        try:
            parameters = getter()
        except Exception:  # noqa: BLE001 - a broken schema must not break the call
            parameters = None
    return {
        "name": str(name),
        "description": _redact_text(description),
        "parameters": _redact_json(parameters),
    }


def _thread_id() -> str:
    """Best-effort LangGraph thread id of the running turn."""
    try:
        from langgraph.config import get_config

        config = get_config()
    except Exception:  # noqa: BLE001 - no graph context outside a run
        return ""
    if not isinstance(config, dict):
        return ""
    configurable = config.get("configurable")
    if not isinstance(configurable, dict):
        return ""
    thread_id = configurable.get("thread_id")
    return thread_id if isinstance(thread_id, str) else ""


def _model_name(request: ModelRequest[Any]) -> str:
    model = getattr(request, "model", None)
    for attr in ("model_name", "model", "model_id"):
        value = getattr(model, attr, None)
        if isinstance(value, str) and value:
            return value
    return type(model).__name__ if model is not None else ""


class LlmDebugMiddleware(AgentMiddleware[Any, Any]):
    """Append every outbound model request/response to a JSONL dump."""

    def __init__(self, *, directory: Path, agent_id: str = "") -> None:
        super().__init__()
        self._directory = Path(directory)
        self._agent_id = agent_id
        self._lock = threading.Lock()

    # ── request/response capture ──────────────────────────────────────────
    def _request_payload(self, request: ModelRequest[Any]) -> dict[str, Any]:
        system = getattr(request, "system_message", None)
        system_text = getattr(system, "content", "") if system is not None else ""
        if not isinstance(system_text, str):
            system_text = json.dumps(system_text, ensure_ascii=False, default=str)
        try:
            segments = breakdown_from_model_request(request)
        except Exception:  # noqa: BLE001 - the estimate is a nicety, not a must
            logger.exception("context breakdown failed for the LLM debug dump")
            segments = {}
        return {
            "system_prompt": _redact_text(system_text),
            "messages": [_message_payload(m) for m in getattr(request, "messages", None) or []],
            "tools": [_tool_payload(t) for t in getattr(request, "tools", None) or []],
            "model_settings": _redact_json(dict(getattr(request, "model_settings", None) or {})),
            "segments": segments,
        }

    def _response_payload(self, response: ModelResponse[Any]) -> dict[str, Any]:
        result = list(getattr(response, "result", None) or [])
        usage: Any = None
        for message in reversed(result):
            metadata = getattr(message, "usage_metadata", None)
            if metadata:
                usage = dict(metadata)
                break
        return {
            "messages": [_message_payload(m) for m in result],
            "usage": usage,
        }

    # ── persistence ───────────────────────────────────────────────────────
    def _write(self, record: dict[str, Any]) -> None:
        try:
            self._directory.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime("%Y-%m-%d")
            path = self._directory / f"llm-{stamp}.jsonl"
            line = json.dumps(record, ensure_ascii=False, default=str)
            with self._lock, path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
        except OSError:
            logger.exception("could not write the LLM debug record")

    def _record(
        self,
        request: ModelRequest[Any],
        response: ModelResponse[Any] | None,
        *,
        error: str = "",
        duration_ms: int = 0,
    ) -> dict[str, Any]:
        record: dict[str, Any] = {
            "ts": datetime.now().astimezone().isoformat(),
            "agent_id": self._agent_id,
            "thread_id": _thread_id(),
            "model": _model_name(request),
            "request": self._request_payload(request),
            "duration_ms": duration_ms,
        }
        if response is not None:
            record["response"] = self._response_payload(response)
        if error:
            record["error"] = error
        return record

    # ── middleware hooks ──────────────────────────────────────────────────
    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        started = datetime.now()
        try:
            response = handler(request)
        except Exception as exc:
            self._write(
                self._record(
                    request,
                    None,
                    error=f"{type(exc).__name__}: {exc}",
                    duration_ms=int((datetime.now() - started).total_seconds() * 1000),
                )
            )
            raise
        self._write(
            self._record(
                request,
                response,
                duration_ms=int((datetime.now() - started).total_seconds() * 1000),
            )
        )
        return response

    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any]:
        started = datetime.now()
        try:
            response = await handler(request)
        except Exception as exc:
            await asyncio.to_thread(
                self._write,
                self._record(
                    request,
                    None,
                    error=f"{type(exc).__name__}: {exc}",
                    duration_ms=int((datetime.now() - started).total_seconds() * 1000),
                ),
            )
            raise
        await asyncio.to_thread(
            self._write,
            self._record(
                request,
                response,
                duration_ms=int((datetime.now() - started).total_seconds() * 1000),
            ),
        )
        return response


__all__ = ["LlmDebugMiddleware"]
