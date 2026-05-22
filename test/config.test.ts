import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { getConfigPath, getProvider, loadConfig, saveConfig, toPublicConfig } from "../src/config.js";

test("config creates a default file and stores it with owner-only permissions", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "codexproxy-config-"));
  process.env.CODEXPROXY_HOME = home;

  const config = await loadConfig();
  const file = getConfigPath();
  const mode = (await stat(file)).mode & 0o777;

  assert.equal(config.port, 8080);
  assert.equal(config.defaultProvider, "default");
  assert.equal(mode, 0o600);
});

test("config saves providers and masks api keys in public output", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "codexproxy-config-"));
  process.env.CODEXPROXY_HOME = home;

  await saveConfig({
    port: 9090,
    defaultProvider: "deepseek",
    providers: [
      { providerType: "anthropic", name: "deepseek", baseUrl: "https://api.deepseek.com", apiKey: "secret-key", defaultModel: "deepseek-chat" }
    ]
  });

  const provider = await getProvider("deepseek");
  const publicConfig = toPublicConfig(await loadConfig());

  assert.equal(provider.baseUrl, "https://api.deepseek.com");
  assert.equal(provider.providerType, "anthropic");
  assert.equal(provider.apiKey, "secret-key");
  assert.equal(publicConfig.providers[0]?.apiKey, "**********");
});
