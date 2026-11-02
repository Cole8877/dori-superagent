import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";

import { fill, loadConfig } from "../src/config.ts";
import { withState } from "./fakes.ts";

const state = withState();
afterEach(() => {
  delete process.env.DORI_STATE_DIR;
});

test("the shipped example config loads, with ~ paths expanded and unset fields defaulted", async () => {
  const c = await loadConfig(join(import.meta.dir, "../../references/config.example.json"), "/home/ana");
  expect(c.stateDir).toBe("/home/ana/.dori/state");
  expect(c.defaultCwd).toBe("/home/ana/code/my-project");
  expect(c.closeAfterMin).toBe(5);
  expect(c.guard.diskFreeMinGb).toBe(50);
});

test("a missing config file falls back to defaults and DORI_STATE_DIR wins over the file", async () => {
  process.env.DORI_STATE_DIR = state.dir;
  const c = await loadConfig("/nonexistent/config.json", "/home/ana");
  expect(c.stateDir).toBe(state.dir);
  expect(c.agentCommand).toEqual(["omo", "--model", "{model}", "{prompt}"]);
});

test("agent omp switches the launch command and session directory; explicit fields still win", async () => {
  const path = join(state.dir, "omp.json");
  await Bun.write(path, JSON.stringify({ agent: "omp" }));
  const omp = await loadConfig(path, "/home/ana");
  expect(omp.agentCommand).toEqual(["omp", "--model", "{model}", "--goal", "{prompt}"]);
  expect(omp.sessionsDir).toBe("/home/ana/.omp/agent/sessions");

  await Bun.write(path, JSON.stringify({ agent: "omp", sessionsDir: "~/sessions", agentCommand: ["omp", "{prompt}"] }));
  const custom = await loadConfig(path, "/home/ana");
  expect(custom.sessionsDir).toBe("/home/ana/sessions");
  expect(custom.agentCommand).toEqual(["omp", "{prompt}"]);
});

test("an unknown agent is refused instead of silently launching omo", async () => {
  const path = join(state.dir, "bad.json");
  await Bun.write(path, JSON.stringify({ agent: "claude" }));
  await expect(loadConfig(path, "/home/ana")).rejects.toThrow('config agent must be "omo" or "omp"');
});

test("hook templates fill each argument separately, so text with spaces or quotes stays one argument", () => {
  const argv = fill(["notify", "--thread", "{thread}", "--text", "{text}"], { thread: "chat:1/2", text: `it's "done"; rm -rf /` });
  expect(argv).toEqual(["notify", "--thread", "chat:1/2", "--text", `it's "done"; rm -rf /`]);
});
