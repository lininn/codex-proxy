import express from "express";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getConfigDir, loadConfig, normalizeConfig, saveConfig, toPublicConfig } from "./config.js";
import { handleResponses, passthrough } from "./proxy.js";
import type { Config } from "./types.js";

const LOG_DIR = path.join(getConfigDir(), "logs");
const LOG_FILE = path.join(LOG_DIR, "codexproxy.log");

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function log(message: string): void {
  ensureLogDir();
  const timestamp = new Date().toISOString();
  appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
}

export async function createApp(config?: Config, options: { closeOnConfigSave?: () => void } = {}): Promise<express.Express> {
  config ??= await loadConfig();
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.post("/v1/responses", async (req, res) => {
    log(`REQUEST: ${req.method} ${req.originalUrl} - body: ${JSON.stringify(req.body).slice(0, 200)}`);
    await runProxyRoute(req, res, () => handleResponses(req, res, config));
  });
  app.post("/v1/chat/completions", async (req, res) => {
    log(`REQUEST: ${req.method} ${req.originalUrl}`);
    await runProxyRoute(req, res, () => passthrough(req, res, config));
  });
  app.get("/v1/models", async (req, res) => {
    log(`REQUEST: ${req.method} ${req.originalUrl}`);
    await runProxyRoute(req, res, () => passthrough(req, res, config));
  });
  app.get("/v1/models/:model", async (req, res) => {
    log(`REQUEST: ${req.method} ${req.originalUrl}`);
    await runProxyRoute(req, res, () => passthrough(req, res, config));
  });
  app.get("/__codexproxy/config", (_req, res) => {
    res.json(toPublicConfig(config));
  });
  app.put("/__codexproxy/config", async (req, res) => {
    try {
      const existingConfig = await loadConfig();
      const nextConfig = normalizeConfig(req.body as Config, existingConfig);
      await saveConfig(nextConfig);
      res.json(toPublicConfig(nextConfig));
      options.closeOnConfigSave?.();
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  app.get("/", (_req, res) => {
    res.redirect("/__codexproxy/web");
  });
  app.get("/__codexproxy/web", async (_req, res) => {
    res.type("html").send(await readWebHtml());
  });
  return app;
}

async function runProxyRoute(
  req: express.Request,
  res: express.Response,
  action: () => Promise<void>
): Promise<void> {
  try {
    await action();
  } catch (error) {
    log(`ERROR: ${req.method} ${req.originalUrl} - ${(error as Error).message}`);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(500).json({ error: (error as Error).message });
  }
}

export async function readWebHtml(): Promise<string> {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "web", "index.html");
  try {
    return await readFile(htmlPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return await readFile(path.resolve("src/web/index.html"), "utf8");
  }
}

export async function startServer(options: { port?: number } = {}): Promise<{ port: number; close: () => Promise<void> }> {
  const config = await loadConfig();
  const app = await createApp(config);
  const port = options.port ?? config.port;
  return await new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => {
      resolve({
        port,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => error ? closeReject(error) : closeResolve());
        })
      });
    });
    server.once("error", reject);
  });
}
