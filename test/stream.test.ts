import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";

import { forwardAnthropicStream, forwardStream } from "../src/stream.js";
import { AnthropicStreamTranslator, StreamTranslator } from "../src/translator.js";

class MemoryResponse extends Writable {
  chunks: string[] = [];
  headers: Record<string, string> = {};

  setHeader(name: string, value: string): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }
}

test("forwardStream converts Chat Completions SSE to Responses SSE", async () => {
  const body = [
    "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hi\"}}]}",
    "",
    "data: [DONE]",
    ""
  ].join("\n");
  const upstream = new Response(body, { headers: { "content-type": "text/event-stream" } });
  const res = new MemoryResponse();

  const result = await forwardStream(upstream, res, new StreamTranslator("resp_1", "m"));

  const output = res.chunks.join("");
  assert.match(output, /event: response.created/);
  assert.match(output, /event: response.output_text.delta/);
  assert.match(output, /"delta":"Hi"/);
  assert.match(output, /event: response.completed/);
  assert.equal(result.ok, true);
});

test("forwardStream emits a failed Responses event when upstream SSE is malformed", async () => {
  const body = [
    "data: {\"id\":\"c1\",\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hi\"}}]}",
    "",
    "data: {not json}",
    ""
  ].join("\n");
  const upstream = new Response(body, { headers: { "content-type": "text/event-stream" } });
  const res = new MemoryResponse();

  const result = await forwardStream(upstream, res, new StreamTranslator("resp_1", "m"));

  const output = res.chunks.join("");
  assert.match(output, /event: response.output_text.delta/);
  assert.match(output, /event: response.failed/);
  assert.match(output, /Upstream stream failed/);
  assert.equal(result.ok, false);
});

test("forwardAnthropicStream converts Anthropic SSE to Responses SSE", async () => {
  const body = [
    "event: content_block_delta",
    "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}",
    "",
    "event: message_stop",
    "data: {\"type\":\"message_stop\"}",
    ""
  ].join("\n");
  const upstream = new Response(body, { headers: { "content-type": "text/event-stream" } });
  const res = new MemoryResponse();

  const result = await forwardAnthropicStream(upstream, res, new AnthropicStreamTranslator("resp_1", "claude-sonnet-4"));

  const output = res.chunks.join("");
  assert.match(output, /event: response.created/);
  assert.match(output, /event: response.output_text.delta/);
  assert.match(output, /"delta":"Hi"/);
  assert.match(output, /event: response.completed/);
  assert.equal(result.ok, true);
});
