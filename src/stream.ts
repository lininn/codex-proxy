import type { ServerResponse } from "node:http";

import { AnthropicStreamTranslator, StreamTranslator } from "./translator.js";
import type { AnthropicStreamEvent, ChatCompletionChunk, ResponsesSSEEvent } from "./types.js";

interface WritableResponse {
  write(chunk: string): unknown;
  end(): unknown;
  setHeader(name: string, value: string): unknown;
}

export async function forwardStream(
  upstream: Response,
  res: WritableResponse,
  translator: StreamTranslator
): Promise<void> {
  try {
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache");

    for (const event of translator.onStart()) {
      writeEvent(res, event);
    }

    const reader = upstream.body?.getReader();
    if (!reader) {
      for (const event of translator.onDone()) writeEvent(res, event);
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          for (const event of translator.onDone()) writeEvent(res, event);
          res.end();
          return;
        }
        const chunk = JSON.parse(payload) as ChatCompletionChunk;
        for (const event of translator.onDelta(chunk)) {
          writeEvent(res, event);
        }
      }
    }

    for (const event of translator.onDone()) writeEvent(res, event);
    res.end();
  } catch (error) {
    for (const event of translator.onError((error as Error).message)) writeEvent(res, event);
    res.end();
  }
}

export async function forwardAnthropicStream(
  upstream: Response,
  res: WritableResponse,
  translator: AnthropicStreamTranslator
): Promise<void> {
  try {
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache");

    for (const event of translator.onStart()) {
      writeEvent(res, event);
    }

    const reader = upstream.body?.getReader();
    if (!reader) {
      for (const event of translator.onDone()) writeEvent(res, event);
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("event:") || !trimmed.startsWith("data:")) {
          if (!trimmed.startsWith("data:")) continue;
        }
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        const event = JSON.parse(payload) as AnthropicStreamEvent;
        for (const responseEvent of translator.onDelta(event)) {
          writeEvent(res, responseEvent);
        }
        if (event.type === "message_stop") {
          for (const responseEvent of translator.onDone()) writeEvent(res, responseEvent);
          res.end();
          return;
        }
      }
    }

    for (const event of translator.onDone()) writeEvent(res, event);
    res.end();
  } catch (error) {
    for (const event of translator.onError((error as Error).message)) writeEvent(res, event);
    res.end();
  }
}

function writeEvent(res: WritableResponse, event: ResponsesSSEEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
