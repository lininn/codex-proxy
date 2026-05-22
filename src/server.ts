import express from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, normalizeConfig, saveConfig, toPublicConfig } from "./config.js";
import { handleResponses, passthrough } from "./proxy.js";
import type { Config } from "./types.js";

export async function createApp(config?: Config, options: { closeOnConfigSave?: () => void } = {}): Promise<express.Express> {
  config ??= await loadConfig();
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.post("/v1/responses", (req, res) => {
    void handleResponses(req, res, config);
  });
  app.post("/v1/chat/completions", (req, res) => {
    void passthrough(req, res, config);
  });
  app.get("/v1/models", (req, res) => {
    void passthrough(req, res, config);
  });
  app.get("/v1/models/:model", (req, res) => {
    void passthrough(req, res, config);
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
    const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "web", "index.html");
    try {
      res.type("html").send(await readFile(htmlPath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      res.type("html").send(await readFile(path.resolve("src/web/index.html"), "utf8"));
    }
  });
  return app;
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
