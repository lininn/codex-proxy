import { spawn } from "node:child_process";
import { createWriteStream as createWriteStreamSync, existsSync, mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getConfigDir } from "./config.js";

const LOG_DIR = path.join(getConfigDir(), "logs");
const LOG_FILE = path.join(LOG_DIR, "codexproxy.log");

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

export interface ServiceState {
  pid: number;
  port: number;
}

export interface StopHooks {
  isRunning?: (pid: number) => boolean;
  kill?: (pid: number) => void;
}

export function getServiceStatePath(): string {
  return path.join(getConfigDir(), "codexproxy.pid.json");
}

export async function readServiceState(): Promise<ServiceState | undefined> {
  try {
    return JSON.parse(await readFile(getServiceStatePath(), "utf8")) as ServiceState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeServiceState(state: ServiceState): Promise<void> {
  await writeFile(getServiceStatePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

export async function removeServiceState(): Promise<void> {
  await rm(getServiceStatePath(), { force: true });
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function stopManagedProxy(hooks: StopHooks = {}): Promise<{ stopped: boolean; reason: "not-running" | "stale" | "stopped" }> {
  const state = await readServiceState();
  if (!state) return { stopped: false, reason: "not-running" };

  const isRunning = hooks.isRunning ?? isProcessRunning;
  const kill = hooks.kill ?? ((pid: number) => process.kill(pid, "SIGTERM"));
  if (!isRunning(state.pid)) {
    await removeServiceState();
    return { stopped: false, reason: "stale" };
  }

  kill(state.pid);
  await removeServiceState();
  return { stopped: true, reason: "stopped" };
}

export async function startManagedProxy(options: { port: number; scriptPath: string }): Promise<ServiceState> {
  const existing = await readServiceState();
  if (existing && isProcessRunning(existing.pid)) {
    return existing;
  }
  if (existing) {
    await removeServiceState();
  }

  ensureLogDir();

  const child = spawn(process.execPath, [options.scriptPath, "serve", "--port", String(options.port)], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });

  // 在后台进程启动后，写入日志
  child.unref();

  // 记录启动日志
  const timestamp = new Date().toISOString();
  const fs = await import("node:fs");
  fs.appendFileSync(LOG_FILE, `[${timestamp}] Starting codex-proxy on port ${options.port}, pid=${child.pid}\n`);

  const state = { pid: child.pid ?? 0, port: options.port };
  await writeServiceState(state);
  return state;
}

export function getLogPath(): string {
  return LOG_FILE;
}

export async function readLogs(lines: number = 100): Promise<string> {
  try {
    const content = await readFile(LOG_FILE, "utf8");
    const allLines = content.split("\n");
    return allLines.slice(-lines).join("\n");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "No logs found. Service may not have started yet.";
    }
    throw error;
  }
}

export async function clearLogs(): Promise<void> {
  try {
    if (existsSync(LOG_FILE)) {
      await writeFile(LOG_FILE, "", { mode: 0o600 });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
