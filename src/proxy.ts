import type { Request, Response as ExpressResponse } from "express";

import { getProvider } from "./config.js";
import { forwardAnthropicStream, forwardStream } from "./stream.js";
import {
  AnthropicStreamTranslator,
  StreamTranslator,
  translateAnthropicRequest,
  translateAnthropicResponse,
  translateRequest,
  translateResponse
} from "./translator.js";
import type { AnthropicMessagesResponse, ChatCompletionsResponse, Config, ResponsesRequest } from "./types.js";

type FetchImpl = typeof fetch;
type MinimalRequest = Pick<Request, "body" | "headers" | "method" | "originalUrl">;
interface MinimalResponse {
  status(code: number): MinimalResponse;
  json(value: unknown): MinimalResponse;
  send(value: unknown): MinimalResponse;
  setHeader(name: string, value: string): MinimalResponse;
}

let _logFn: ((message: string) => void) | undefined;
export function setLogFn(fn: (message: string) => void): void {
  _logFn = fn;
}
function log(message: string): void {
  _logFn?.(message);
}

export async function handleResponses(
  req: Pick<Request, "body">,
  res: MinimalResponse,
  config: Config,
  fetchImpl: FetchImpl = fetch
): Promise<void> {
  const startTime = Date.now();
  let provider;
  try {
    provider = await getProvider(undefined, config);
  } catch (error) {
    log(`AUTH_ERROR: ${(error as Error).message}`);
    res.status(401).json({ error: String((error as Error).message) });
    return;
  }
  if (!provider.apiKey) {
    log("AUTH_ERROR: Provider API key is not configured.");
    res.status(401).json({ error: "Provider API key is not configured." });
    return;
  }

  const body = req.body as ResponsesRequest;
  const validationError = validateResponsesRequest(body);
  if (validationError) {
    log(`BAD_REQUEST: ${validationError}`);
    res.status(400).json({ error: validationError });
    return;
  }
  const providerType = provider.providerType ?? "chat";
  const upstreamBody = providerType === "anthropic"
    ? translateAnthropicRequest(body, provider.defaultModel)
    : translateRequest(body, provider.defaultModel);
  const endpoint = providerType === "anthropic" ? "/messages" : "/chat/completions";
  const headers: Record<string, string> = providerType === "anthropic"
    ? {
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      }
    : {
        "authorization": `Bearer ${provider.apiKey}`,
        "content-type": "application/json"
      };
  let upstream: globalThis.Response;
  try {
    upstream = await fetchImpl(joinUrl(provider.baseUrl, endpoint), {
      method: "POST",
      headers,
      body: JSON.stringify(upstreamBody)
    });
  } catch (error) {
    log(`UPSTREAM_FETCH_ERROR: ${(error as Error).message} - ${Date.now() - startTime}ms`);
    res.status(502).json({ error: `Upstream request failed: ${(error as Error).message}` });
    return;
  }

  if (!upstream.ok) {
    const errorBody = await upstream.text();
    log(`UPSTREAM_ERROR: status=${upstream.status} body=${errorBody.slice(0, 500)} - ${Date.now() - startTime}ms`);
    res.status(upstream.status).send(errorBody);
    return;
  }

  if (body.stream) {
    const streamResult = providerType === "anthropic"
      ? await forwardAnthropicStream(upstream, res as ExpressResponse, new AnthropicStreamTranslator(undefined, upstreamBody.model))
      : await forwardStream(upstream, res as ExpressResponse, new StreamTranslator(undefined, upstreamBody.model));
    if (streamResult.ok) {
      log(`STREAM_DONE: ${Date.now() - startTime}ms`);
    } else {
      log(`STREAM_FAILED: ${streamResult.error ?? "unknown error"} - ${Date.now() - startTime}ms`);
    }
    return;
  }

  const translated = providerType === "anthropic"
    ? translateAnthropicResponse(await upstream.json() as AnthropicMessagesResponse)
    : translateResponse(await upstream.json() as ChatCompletionsResponse);
  log(`RESPONSE: ${Date.now() - startTime}ms`);
  res.status(200).json(translated);
}

function validateResponsesRequest(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return "Responses request body must be an object.";
  }
  const input = (body as Partial<ResponsesRequest>).input;
  if (typeof input !== "string" && !Array.isArray(input)) {
    return "Responses request input must be a string or an array.";
  }
  return undefined;
}

export async function passthrough(
  req: MinimalRequest,
  res: MinimalResponse,
  config: Config,
  fetchImpl: FetchImpl = fetch
): Promise<void> {
  const provider = await getProvider(undefined, config);
  const upstream = await fetchImpl(joinUrl(provider.baseUrl, stripV1(req.originalUrl ?? "")), {
    method: req.method,
    headers: {
      "authorization": `Bearer ${provider.apiKey}`,
      "content-type": String(req.headers["content-type"] ?? "application/json")
    },
    body: req.method === "GET" ? undefined : JSON.stringify(req.body)
  });
  const contentType = upstream.headers.get("content-type") ?? "application/json";
  res.status(upstream.status);
  res.setHeader("content-type", contentType);
  if (contentType.includes("application/json")) {
    res.json(await upstream.json());
  } else {
    res.send(await upstream.text());
  }
}

function stripV1(url: string): string {
  return url.startsWith("/v1/") ? url.slice(3) : url;
}

function joinUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}
