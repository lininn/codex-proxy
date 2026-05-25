#!/usr/bin/env node
import { Command } from "commander";
import open from "open";
import { fileURLToPath } from "node:url";

import { getConfigPath, loadConfig } from "./config.js";
import { createApp, startServer } from "./server.js";
import { clearLogs, getLogPath, readLogs, startManagedProxy, stopManagedProxy } from "./service.js";

const program = new Command();

program
  .name("codex-proxy")
  .description("Local Responses API proxy for Chat Completions and Anthropic-compatible providers.")
  .version("0.1.0")
  .option("--web", "open the configuration page");

program
  .command("start")
  .description("start the local proxy")
  .option("-p, --port <port>", "port to listen on")
  .action(async (options: { port?: string }) => {
    const config = await loadConfig();
    const port = options.port ? Number(options.port) : config.port;
    const state = await startManagedProxy({ port, scriptPath: fileURLToPath(import.meta.url) });
    console.log(`codex-proxy started on http://127.0.0.1:${state.port}`);
  });

program
  .command("stop")
  .description("stop the local proxy")
  .action(async () => {
    const result = await stopManagedProxy();
    if (result.reason === "not-running") {
      console.log("codex-proxy is not running");
      return;
    }
    if (result.reason === "stale") {
      console.log("removed stale codex-proxy state");
      return;
    }
    console.log("codex-proxy stopped");
  });

program
  .command("restart")
  .description("restart the local proxy")
  .option("-p, --port <port>", "port to listen on")
  .action(async (options: { port?: string }) => {
    await stopManagedProxy();
    const config = await loadConfig();
    const port = options.port ? Number(options.port) : config.port;
    const state = await startManagedProxy({ port, scriptPath: fileURLToPath(import.meta.url) });
    console.log(`codex-proxy restarted on http://127.0.0.1:${state.port}`);
  });

program
  .command("web", { hidden: true })
  .description("open the configuration page")
  .action(async () => {
    const config = await loadConfig();
    let closeServer: (() => Promise<void>) | undefined;
    const app = await createApp(config, {
      closeOnConfigSave: () => {
        setTimeout(() => void closeServer?.(), 50);
      }
    });
    const server = await new Promise<{ port: number; close: () => Promise<void> }>((resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1", () => {
        const address = listener.address();
        if (!address || typeof address === "string") {
          reject(new Error("Expected TCP server address"));
          return;
        }
        resolve({
          port: address.port,
          close: () => new Promise((closeResolve, closeReject) => {
            listener.close((error) => error ? closeReject(error) : closeResolve());
          })
        });
      });
      listener.once("error", reject);
    });
    closeServer = server.close;
    const url = `http://127.0.0.1:${server.port}/__codexproxy/web`;
    console.log(`codex-proxy config open at ${url}`);
    await open(url);
    await new Promise<void>((resolve) => {
      closeServer = async () => {
        await server.close();
        resolve();
      };
      process.once("SIGINT", () => void closeServer?.());
      process.once("SIGTERM", () => void closeServer?.());
    });
  });

program
  .command("serve", { hidden: true })
  .description("run the proxy in the foreground")
  .option("-p, --port <port>", "port to listen on")
  .action(async (options: { port?: string }) => {
    const server = await startServer({ port: options.port ? Number(options.port) : undefined });
    console.log(`codex-proxy listening on http://127.0.0.1:${server.port}`);
    await new Promise<void>((resolve) => {
      const stop = async () => {
        await server.close();
        resolve();
      };
      process.once("SIGINT", () => void stop());
      process.once("SIGTERM", () => void stop());
    });
  });

program
  .command("config")
  .description("print the configuration file path")
  .action(() => {
    console.log(getConfigPath());
  });

program
  .command("logs")
  .description("show recent log entries")
  .option("-n, --lines <lines>", "number of lines to show", "100")
  .action(async (options: { lines?: string }) => {
    const logs = await readLogs(options.lines ? Number(options.lines) : 100);
    console.log(logs);
  });

program
  .command("clear-logs")
  .description("clear log files")
  .action(async () => {
    await clearLogs();
    console.log("Logs cleared");
  });

program
  .command("log-path")
  .description("print the log file path")
  .action(() => {
    console.log(getLogPath());
  });

if (process.argv.includes("--web") && process.argv.length === 3) {
  process.argv.push("web");
}

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
