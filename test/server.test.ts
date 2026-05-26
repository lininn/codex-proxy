import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { loadConfig, saveConfig } from "../src/config.js";
import { handleResponses } from "../src/proxy.js";
import { createApp, readWebHtml } from "../src/server.js";
import type { Config } from "../src/types.js";

async function listen(config: Config): Promise<{ url: string; close: () => Promise<void> }> {
  const app = await createApp(config);
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected TCP server address"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => error ? closeReject(error) : closeResolve());
        })
      });
    });
    server.once("error", reject);
  });
}

class JsonResponse {
  statusCode = 200;
  body: unknown;

  status(code: number): this {
    this.statusCode = code;
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

  setHeader(): this {
    return this;
  }
}

test("packaged web UI asset is available without relying on cwd", async () => {
  const html = await readWebHtml();
  const asset = await stat(new URL("../src/web/index.html", import.meta.url));

  assert.equal(asset.isFile(), true);
  assert.match(html, /id="providerList"/);
  assert.match(html, /id="providerType"/);
  assert.match(html, /codex-proxy/);
});

test("config API preserves multiple provider keys and switches the active provider", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "codexproxy-server-"));
  process.env.CODEXPROXY_HOME = home;
  const config: Config = {
    port: 8080,
    defaultProvider: "deepseek",
    providers: [
      { name: "deepseek", baseUrl: "https://deepseek.example/v1", apiKey: "deepseek-key", defaultModel: "deepseek-chat" },
      { name: "kimi", baseUrl: "https://kimi.example/v1", apiKey: "kimi-key", defaultModel: "kimi-k2" }
    ]
  };
  await saveConfig(config);
  const server = await listen(config);
  try {
    const response = await fetch(`${server.url}/__codexproxy/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        port: 8080,
        defaultProvider: "kimi",
        providers: [
          { name: "deepseek", baseUrl: "https://deepseek.example/v1", apiKey: "**********", defaultModel: "deepseek-chat" },
          { name: "kimi", baseUrl: "https://kimi.example/v1", apiKey: "", defaultModel: "kimi-k2" }
        ]
      })
    });

    assert.equal(response.status, 200);
    const saved = await loadConfig();
    assert.equal(saved.defaultProvider, "kimi");
    assert.equal(saved.providers.find((provider) => provider.name === "deepseek")?.apiKey, "deepseek-key");
    assert.equal(saved.providers.find((provider) => provider.name === "kimi")?.apiKey, "kimi-key");
  } finally {
    await server.close();
  }
});

test("config API save does not hot-reload the running proxy provider", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "codexproxy-server-"));
  process.env.CODEXPROXY_HOME = home;
  const config: Config = {
    port: 8080,
    defaultProvider: "deepseek",
    providers: [
      { name: "deepseek", baseUrl: "https://deepseek.example/v1", apiKey: "deepseek-key", defaultModel: "deepseek-chat" },
      { name: "kimi", baseUrl: "https://kimi.example/v1", apiKey: "kimi-key", defaultModel: "kimi-k2" }
    ]
  };
  await saveConfig(config);
  const server = await listen(config);
  try {
    const response = await fetch(`${server.url}/__codexproxy/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        port: 8080,
        defaultProvider: "kimi",
        providers: [
          { name: "deepseek", baseUrl: "https://deepseek.example/v1", apiKey: "**********", defaultModel: "deepseek-chat" },
          { name: "kimi", baseUrl: "https://kimi.example/v1", apiKey: "********", defaultModel: "kimi-k2" }
        ]
      })
    });
    assert.equal(response.status, 200);

    const calls: string[] = [];
    const proxyResponse = new JsonResponse();
    await handleResponses(
      { body: { model: "ignored", input: "hi" } },
      proxyResponse,
      config,
      async (url) => {
        calls.push(String(url));
        return Response.json({
          id: "chatcmpl_1",
          object: "chat.completion",
          created: 1710000000,
          model: "deepseek-chat",
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }]
        });
      }
    );

    assert.equal(calls[0], "https://deepseek.example/v1/chat/completions");
    assert.equal((await loadConfig()).defaultProvider, "kimi");
  } finally {
    await server.close();
  }
});

test("config API rejects a default provider that is not in the provider list", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "codexproxy-server-"));
  process.env.CODEXPROXY_HOME = home;
  const config: Config = {
    port: 8080,
    defaultProvider: "deepseek",
    providers: [
      { name: "deepseek", baseUrl: "https://deepseek.example/v1", apiKey: "deepseek-key", defaultModel: "deepseek-chat" }
    ]
  };
  await saveConfig(config);
  const server = await listen(config);
  try {
    const response = await fetch(`${server.url}/__codexproxy/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        port: 8080,
        defaultProvider: "missing",
        providers: [
          { name: "deepseek", baseUrl: "https://deepseek.example/v1", apiKey: "**********", defaultModel: "deepseek-chat" }
        ]
      })
    });

    assert.equal(response.status, 400);
    assert.equal((await loadConfig()).defaultProvider, "deepseek");
  } finally {
    await server.close();
  }
});

test("responses route rejects missing input without contacting upstream", async () => {
  const config: Config = {
    port: 8080,
    defaultProvider: "default",
    providers: [{ name: "default", baseUrl: "https://upstream.example/v1", apiKey: "key", defaultModel: "model" }]
  };
  const server = await listen(config);
  try {
    const response = await fetch(`${server.url}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "model" }),
      signal: AbortSignal.timeout(1000)
    });
    const body = await response.json() as { error: string };

    assert.equal(response.status, 400);
    assert.match(body.error, /input/);
  } finally {
    await server.close();
  }
});

test("web UI exposes multiple provider management controls", async () => {
  const config: Config = {
    port: 8080,
    defaultProvider: "deepseek",
    providers: [
      { name: "deepseek", baseUrl: "https://deepseek.example/v1", apiKey: "deepseek-key", defaultModel: "deepseek-chat" },
      { name: "kimi", baseUrl: "https://kimi.example/v1", apiKey: "kimi-key", defaultModel: "kimi-k2" }
    ]
  };
  const server = await listen(config);
  try {
    const html = await fetch(`${server.url}/__codexproxy/web`).then((response) => response.text());

    assert.match(html, /id="providerList"/);
    assert.match(html, /id="addProvider"/);
    assert.match(html, /id="deleteProvider"/);
    assert.match(html, /defaultProvider/);
    assert.match(html, /provider\.name === selectedName \? " selected" : ""/);
    assert.match(html, /current\.providers\.some\(\(provider\) => provider\.name === current\.defaultProvider\)/);
  } finally {
    await server.close();
  }
});
