"""The opt-in LLM request/response dump."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from langchain.agents.middleware import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from octop.infra.agents.middleware.llm_debug import LlmDebugMiddleware


def _read_records(directory: Path) -> list[dict]:
    files = sorted(directory.glob("llm-*.jsonl"))
    assert files, "no LLM debug dump was written"
    records: list[dict] = []
    for path in files:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                records.append(json.loads(line))
    return records


def _request() -> ModelRequest:
    model = ChatOpenAI(model="gpt-4o-mini", api_key="test")
    return ModelRequest(
        model=model,
        messages=[HumanMessage(content="我最擅长用什么语言开发？")],
        system_message=SystemMessage(content="你是一个编程导师。"),
        tools=[
            {
                "type": "function",
                "function": {"name": "ls", "parameters": {"type": "object", "properties": {}}},
            }
        ],
    )


def test_writes_request_and_response(tmp_path: Path) -> None:
    middleware = LlmDebugMiddleware(directory=tmp_path / "llm", agent_id="85KGRA")

    def handler(request: ModelRequest) -> ModelResponse:
        return ModelResponse(
            result=[
                AIMessage(
                    content="Python。",
                    usage_metadata={
                        "input_tokens": 13574,
                        "output_tokens": 262,
                        "total_tokens": 13836,
                    },
                )
            ]
        )

    response = middleware.wrap_model_call(_request(), handler)

    assert response.result[0].content == "Python。"
    records = _read_records(tmp_path / "llm")
    assert len(records) == 1
    record = records[0]
    assert record["agent_id"] == "85KGRA"
    assert record["model"] == "gpt-4o-mini"
    assert record["request"]["system_prompt"] == "你是一个编程导师。"
    assert record["request"]["messages"][0]["content"] == "我最擅长用什么语言开发？"
    assert record["request"]["tools"][0]["function"]["name"] == "ls"
    assert record["response"]["usage"]["output_tokens"] == 262
    assert record["duration_ms"] >= 0


def test_redacts_api_keys_in_prompts(tmp_path: Path) -> None:
    middleware = LlmDebugMiddleware(directory=tmp_path / "llm", agent_id="85KGRA")
    secret = "sk-abcdefghijklmnopqrstuvwxyz012345"
    request = _request()
    request.messages.append(HumanMessage(content=f"我的 key 是 {secret}"))

    middleware.wrap_model_call(request, lambda _req: ModelResponse(result=[]))

    record = _read_records(tmp_path / "llm")[0]
    dumped = json.dumps(record, ensure_ascii=False)
    assert secret not in dumped
    assert "[redacted]" in dumped


def test_records_the_error_and_reraises(tmp_path: Path) -> None:
    middleware = LlmDebugMiddleware(directory=tmp_path / "llm", agent_id="85KGRA")

    def handler(_request: ModelRequest) -> ModelResponse:
        raise RuntimeError("provider exploded")

    with pytest.raises(RuntimeError, match="provider exploded"):
        middleware.wrap_model_call(_request(), handler)

    record = _read_records(tmp_path / "llm")[0]
    assert "provider exploded" in record["error"]
    assert "response" not in record


@pytest.mark.asyncio
async def test_async_path_writes_the_same_record(tmp_path: Path) -> None:
    middleware = LlmDebugMiddleware(directory=tmp_path / "llm", agent_id="85KGRA")

    async def handler(_request: ModelRequest) -> ModelResponse:
        return ModelResponse(result=[AIMessage(content="ok")])

    await middleware.awrap_model_call(_request(), handler)

    record = _read_records(tmp_path / "llm")[0]
    assert record["response"]["messages"][0]["content"] == "ok"
