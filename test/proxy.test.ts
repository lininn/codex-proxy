import assert from "node:assert/strict";
import { test } from "node:test";

import { handleResponses } from "../src/proxy.js";
import type { Config } from "../src/types.js";

class JsonResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: unknown;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  json(value: unknown): this {
    this.body = value;
    return this;
  }

  send(value: unknown): this {
    this.body = value;
    return this;
  }
}

test("handleResponses forwards translated non-streaming requests and returns Responses output", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} });
    return Response.json({
      id: "chatcmpl_1",
      object: "chat.completion",
      created: 1710000000,
      model: "deepseek-chat",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Hello" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    });
  };
  const config: Config = {
    port: 8080,
    defaultProvider: "default",
    providers: [{ name: "default", baseUrl: "https://upstream.example/v1", apiKey: "key", defaultModel: "deepseek-chat" }]
  };
  const res = new JsonResponse();

  await handleResponses({ body: { model: "gpt-5.4", input: "Hi" } }, res, config, fetchImpl);

  assert.equal(calls[0]?.url, "https://upstream.example/v1/chat/completions");
  assert.equal(JSON.parse(String(calls[0]?.init.body)).messages[0].content, "Hi");
  assert.equal(res.statusCode, 200);
  assert.equal((res.body as { output: Array<{ content: Array<{ text: string }> }> }).output[0]?.content[0]?.text, "Hello");
});

test("handleResponses routes anthropic providers to Messages API", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} });
    return Response.json({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4",
      content: [{ type: "text", text: "Hello" }],
      usage: { input_tokens: 1, output_tokens: 1 }
    });
  };
  const config: Config = {
    port: 8080,
    defaultProvider: "anthropic",
    providers: [{
      providerType: "anthropic",
      name: "anthropic",
      baseUrl: "https://anthropic.example/v1",
      apiKey: "key",
      defaultModel: "claude-sonnet-4"
    }]
  };
  const res = new JsonResponse();

  await handleResponses({ body: { model: "ignored", input: "Hi", max_output_tokens: 256 } }, res, config, fetchImpl);

  assert.equal(calls[0]?.url, "https://anthropic.example/v1/messages");
  assert.equal((calls[0]?.init.headers as Record<string, string>)["x-api-key"], "key");
  assert.equal((calls[0]?.init.headers as Record<string, string>)["anthropic-version"], "2023-06-01");
  assert.equal(JSON.parse(String(calls[0]?.init.body)).max_tokens, 256);
  assert.equal(res.statusCode, 200);
  assert.equal((res.body as { output: Array<{ content: Array<{ text: string }> }> }).output[0]?.content[0]?.text, "Hello");
});

test("handleResponses rejects missing input before contacting upstream", async () => {
  let called = false;
  const config: Config = {
    port: 8080,
    defaultProvider: "default",
    providers: [{ name: "default", baseUrl: "https://upstream.example/v1", apiKey: "key", defaultModel: "model" }]
  };
  const res = new JsonResponse();

  await handleResponses(
    { body: { model: "model" } },
    res,
    config,
    async () => {
      called = true;
      return Response.json({});
    }
  );

  assert.equal(called, false);
  assert.equal(res.statusCode, 400);
  assert.match((res.body as { error: string }).error, /input/);
});
