import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Config, Provider, PublicConfig } from "./types.js";

const DEFAULT_CONFIG: Config = {
  port: 8080,
  defaultProvider: "default",
  providers: [
    {
      providerType: "chat",
      name: "default",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      defaultModel: ""
    }
  ]
};

export function getConfigDir(): string {
  return process.env.CODEXPROXY_HOME ?? path.join(os.homedir(), ".codexproxy");
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

export async function loadConfig(): Promise<Config> {
  const file = getConfigPath();
  try {
    return JSON.parse(await readFile(file, "utf8")) as Config;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
    await saveConfig(DEFAULT_CONFIG);
    return structuredClone(DEFAULT_CONFIG);
  }
}

export async function saveConfig(config: Config): Promise<void> {
  const dir = getConfigDir();
  const file = getConfigPath();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
}

export function normalizeConfig(config: Config, existing?: Config): Config {
  const providers: Provider[] = config.providers.map((provider) => {
    const name = provider.name.trim();
    if (!name) throw new Error("Provider name is required.");
    const existingProvider = existing?.providers.find((candidate) => candidate.name === name);
    const apiKey = !provider.apiKey || provider.apiKey.startsWith("*")
      ? existingProvider?.apiKey ?? ""
      : provider.apiKey;
    return {
      providerType: provider.providerType === "anthropic" ? "anthropic" : "chat",
      name,
      baseUrl: provider.baseUrl.trim(),
      apiKey,
      defaultModel: provider.defaultModel?.trim() ?? ""
    };
  });

  if (providers.length === 0) {
    throw new Error("At least one provider is required.");
  }
  const names = new Set<string>();
  for (const provider of providers) {
    if (names.has(provider.name)) throw new Error(`Duplicate provider: ${provider.name}`);
    names.add(provider.name);
  }
  if (!names.has(config.defaultProvider)) {
    throw new Error(`Default provider not found: ${config.defaultProvider}`);
  }
  return {
    port: config.port,
    defaultProvider: config.defaultProvider,
    providers
  };
}

export async function getProvider(name?: string, config?: Config): Promise<Provider> {
  const activeConfig = config ?? await loadConfig();
  const providerName = name ?? activeConfig.defaultProvider;
  const provider = activeConfig.providers.find((candidate) => candidate.name === providerName);
  if (!provider) {
    throw new Error(`Provider not found: ${providerName}`);
  }
  return provider;
}

export function toPublicConfig(config: Config): PublicConfig {
  return {
    ...config,
    providers: config.providers.map((provider) => ({
      ...provider,
      apiKey: provider.apiKey ? "*".repeat(Math.min(provider.apiKey.length, 10)) : ""
    }))
  };
}
