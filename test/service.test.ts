import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  getServiceStatePath,
  readServiceState,
  removeServiceState,
  stopManagedProxy,
  writeServiceState
} from "../src/service.js";

test("service state is stored under CODEXPROXY_HOME", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "codexproxy-service-"));
  process.env.CODEXPROXY_HOME = home;

  await writeServiceState({ pid: 12345, port: 18080 });
  const state = await readServiceState();

  assert.equal(getServiceStatePath(), path.join(home, "codexproxy.pid.json"));
  assert.deepEqual(state, { pid: 12345, port: 18080 });

  await removeServiceState();
  assert.equal(await readServiceState(), undefined);
});

test("stopManagedProxy removes stale process state", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "codexproxy-service-"));
  process.env.CODEXPROXY_HOME = home;
  await writeServiceState({ pid: 999999, port: 18080 });

  const result = await stopManagedProxy({
    isRunning: () => false,
    kill: () => {
      throw new Error("stale process should not be killed");
    }
  });

  assert.equal(result.stopped, false);
  assert.equal(result.reason, "stale");
  assert.equal(await readServiceState(), undefined);
});

test("stopManagedProxy kills running process and removes state", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "codexproxy-service-"));
  process.env.CODEXPROXY_HOME = home;
  await writeServiceState({ pid: 12345, port: 18080 });
  const killed: number[] = [];

  const result = await stopManagedProxy({
    isRunning: () => true,
    kill: (pid) => {
      killed.push(pid);
    }
  });

  assert.deepEqual(killed, [12345]);
  assert.equal(result.stopped, true);
  assert.equal(await readServiceState(), undefined);
});
