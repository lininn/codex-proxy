import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AnthropicStreamTranslator,
  StreamTranslator,
  translateAnthropicRequest,
  translateAnthropicResponse,
  translateRequest,
  translateResponse
} from "../src/translator.js";

test("translator converts Responses requests into Chat Completions requests", () => {
  const translated = translateRequest({
    model: "my-model",
    instructions: "Be concise.",
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] },
      { type: "function_call", name: "lookup", call_id: "call_1", arguments: "{\"q\":\"x\"}" },
      { type: "function_call_output", call_id: "call_1", output: "result" }
    ],
    tools: [{ type: "function", name: "lookup", description: "Search", parameters: { type: "object" } }],
    max_output_tokens: 128,
    temperature: 0.2,
    stream: true
  }, "deepseek-chat");

  assert.equal(translated.model, "deepseek-chat");
  assert.deepEqual(translated.messages, [
    { role: "system", content: "Be concise." },
    { role: "user", content: "Hello" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{\"q\":\"x\"}" } }]
    },
    { role: "tool", tool_call_id: "call_1", content: "result" }
  ]);
  assert.equal(translated.max_tokens, 128);
  assert.equal(translated.tools?.[0]?.function.name, "lookup");
});

test("translator treats null Responses message content as empty text", () => {
  const translated = translateRequest({
    model: "my-model",
    input: [
      { type: "message", role: "assistant", content: null },
      { type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] }
    ],
    stream: true
  }, "deepseek-chat");

  assert.deepEqual(translated.messages, [
    { role: "assistant", content: "" },
    { role: "user", content: "Hello" }
  ]);
});

test("translator converts Chat Completions responses into Responses responses", () => {
  const translated = translateResponse({
    id: "chatcmpl_1",
    object: "chat.completion",
    created: 1710000000,
    model: "deepseek-chat",
    choices: [{
      index: 0,
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: "Hi",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }]
      }
    }],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
  });

  assert.equal(translated.id, "chatcmpl_1");
  assert.equal(translated.status, "completed");
  assert.equal(translated.output[0]?.type, "message");
  assert.equal(translated.output[1]?.type, "function_call");
  assert.deepEqual(translated.usage, { input_tokens: 3, output_tokens: 4, total_tokens: 7 });
});

test("translator converts Responses requests into Anthropic Messages requests", () => {
  const translated = translateAnthropicRequest({
    model: "my-model",
    instructions: "Be concise.",
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] },
      { type: "function_call", name: "lookup", call_id: "call_1", arguments: "{\"q\":\"x\"}" },
      { type: "function_call_output", call_id: "call_1", output: "result" }
    ],
    tools: [{ type: "function", name: "lookup", description: "Search", parameters: { type: "object" } }],
    max_output_tokens: 128,
    stream: true
  }, "claude-sonnet-4");

  assert.equal(translated.model, "claude-sonnet-4");
  assert.equal(translated.system, "Be concise.");
  assert.equal(translated.max_tokens, 128);
  assert.deepEqual(translated.messages, [
    { role: "user", content: "Hello" },
    { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "lookup", input: { q: "x" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "result" }] }
  ]);
  assert.equal(translated.tools?.[0]?.name, "lookup");
});

test("translator converts Anthropic Messages responses into Responses responses", () => {
  const translated = translateAnthropicResponse({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4",
    content: [
      { type: "text", text: "Hi" },
      { type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "x" } }
    ],
    usage: { input_tokens: 3, output_tokens: 4 }
  });

  assert.equal(translated.id, "msg_1");
  assert.equal(translated.output[0]?.type, "message");
  assert.equal(translated.output[1]?.type, "function_call");
  assert.deepEqual(translated.usage, { input_tokens: 3, output_tokens: 4, total_tokens: 7 });
});

test("stream translator emits Responses lifecycle events for text chunks", () => {
  const translator = new StreamTranslator("resp_1", "deepseek-chat");
  const events = [
    ...translator.onStart(),
    ...translator.onDelta({ id: "chunk_1", model: "deepseek-chat", choices: [{ index: 0, delta: { content: "Hel" } }] }),
    ...translator.onDelta({ id: "chunk_2", model: "deepseek-chat", choices: [{ index: 0, delta: { content: "lo" } }] }),
    ...translator.onDone()
  ];

  assert.deepEqual(events.map((event) => event.type), [
    "response.created",
    "response.output_item.added",
    "response.content_part.added",
    "response.output_text.delta",
    "response.output_text.delta",
    "response.output_text.done",
    "response.output_item.done",
    "response.completed"
  ]);
  assert.equal(events.at(-2)?.item?.content?.[0]?.text, "Hello");
});

test("anthropic stream translator emits Responses text deltas", () => {
  const translator = new AnthropicStreamTranslator("resp_1", "claude-sonnet-4");
  const events = [
    ...translator.onStart(),
    ...translator.onDelta({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } }),
    ...translator.onDelta({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } }),
    ...translator.onDone()
  ];

  assert.match(JSON.stringify(events), /response.output_text.delta/);
  assert.equal(events.at(-2)?.item?.content?.[0]?.text, "Hello");
});
