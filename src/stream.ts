import { AnthropicStreamTranslator, StreamTranslator } from "./translator.js";
import type { AnthropicStreamEvent, ChatCompletionChunk, ResponsesSSEEvent } from "./types.js";

interface WritableResponse {
  write(chunk: string): unknown;
  end(): unknown;
  setHeader(name: string, value: string): unknown;
}

export interface StreamForwardResult {
  ok: boolean;
  error?: string;
}

export async function forwardStream(
  upstream: Response,
  res: WritableResponse,
  translator: StreamTranslator
): Promise<StreamForwardResult> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache");

    for (const event of translator.onStart()) {
      writeEvent(res, event);
    }

    reader = upstream.body?.getReader();
    if (!reader) {
      for (const event of translator.onDone()) writeEvent(res, event);
      res.end();
      return { ok: true };
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
          await cancelReader(reader);
          return { ok: true };
        }
        const chunk = JSON.parse(payload) as ChatCompletionChunk;
        for (const event of translator.onDelta(chunk)) {
          writeEvent(res, event);
        }
      }
    }

    for (const event of translator.onDone()) writeEvent(res, event);
    res.end();
    return { ok: true };
  } catch (error) {
    const message = (error as Error).message;
    for (const event of translator.onError(message)) writeEvent(res, event);
    res.end();
    await cancelReader(reader);
    return { ok: false, error: message };
  } finally {
    releaseReader(reader);
  }
}

export async function forwardAnthropicStream(
  upstream: Response,
  res: WritableResponse,
  translator: AnthropicStreamTranslator
): Promise<StreamForwardResult> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache");

    for (const event of translator.onStart()) {
      writeEvent(res, event);
    }

    reader = upstream.body?.getReader();
    if (!reader) {
      for (const event of translator.onDone()) writeEvent(res, event);
      res.end();
      return { ok: true };
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
          await cancelReader(reader);
          return { ok: true };
        }
      }
    }

    for (const event of translator.onDone()) writeEvent(res, event);
    res.end();
    return { ok: true };
  } catch (error) {
    const message = (error as Error).message;
    for (const event of translator.onError(message)) writeEvent(res, event);
    res.end();
    await cancelReader(reader);
    return { ok: false, error: message };
  } finally {
    releaseReader(reader);
  }
}

function writeEvent(res: WritableResponse, event: ResponsesSSEEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array> | undefined): Promise<void> {
  try {
    await reader?.cancel();
  } catch {
    // The response is already ending; cleanup failures should not mask the stream result.
  }
}

function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array> | undefined): void {
  try {
    reader?.releaseLock();
  } catch {
    // Some implementations throw if the reader is already released.
  }
}
