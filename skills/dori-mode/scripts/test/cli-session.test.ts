import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { withState } from "./fakes.ts";

// These run the real src/cli.ts as a subprocess with a fake `herdr` first on PATH, so a CLI call site that
// bypasses the session-pinned runner reaches herdr without --session and fails here.
const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const SESSION = "omo-delegate";
let state: ReturnType<typeof withState>;
let log: string;
let env: Record<string, string>;

beforeEach(() => {
  state = withState();
  const bin = join(state.dir, "bin");
  mkdirSync(bin);
  log = join(state.dir, "herdr.log");
  writeFileSync(join(bin, "herdr"), `#!/bin/sh\necho "$*" >> "${log}"\ncase "$*" in *"pane list"*) echo '{"result":{"panes":[]}}';; esac\n`);
  chmodSync(join(bin, "herdr"), 0o755);
  const config = join(state.dir, "config.json");
  writeFileSync(config, JSON.stringify({ herdrSession: SESSION, heavyMaxLoad: 1_000_000 }));
  env = { ...(process.env as Record<string, string>), PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: state.dir, DORI_CONFIG: config, DORI_STATE_DIR: join(state.dir, "state"), HERDR_SESSION: "caller-session", HERDR_SOCKET_PATH: join(state.dir, "caller.sock") };
});
afterEach(() => state.done());

const herdrCalls = async (args: string[]): Promise<string[]> => {
  const p = Bun.spawn([process.execPath, CLI, ...args], { env, stdout: "pipe", stderr: "pipe" });
  await p.exited;
  try { return readFileSync(log, "utf8").split("\n").filter(Boolean); } catch { return []; }
};
const pinned = (calls: string[]) => expect(calls.every((c) => c.startsWith(`--session ${SESSION} `))).toBe(true);

test("cli sync pins every herdr call to the configured session", async () => {
  const calls = await herdrCalls(["sync"]);
  expect(calls.length).toBeGreaterThan(0);
  pinned(calls);
});

test("cli dead-panes pins every herdr call to the configured session", async () => {
  const calls = await herdrCalls(["dead-panes"]);
  expect(calls.length).toBeGreaterThan(0);
  pinned(calls);
});

test("cli guard pins the host sample's herdr call to the configured session", async () => {
  const calls = await herdrCalls(["guard"]);
  expect(calls.length).toBeGreaterThan(0);
  pinned(calls);
});

test("cli can-launch pins the host sample's herdr call to the configured session", async () => {
  const calls = await herdrCalls(["can-launch"]);
  expect(calls.length).toBeGreaterThan(0);
  pinned(calls);
});

test("cli heavy pins its load sample's herdr call to the configured session", async () => {
  const calls = await herdrCalls(["heavy", "t", "--", "true"]);
  expect(calls.length).toBeGreaterThan(0);
  pinned(calls);
});
