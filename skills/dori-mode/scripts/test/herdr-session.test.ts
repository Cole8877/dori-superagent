import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { deadPaneTick, newDeadPaneState } from "../src/dead-panes.ts";
import { launchLane } from "../src/launch.ts";
import { syncRegistry } from "../src/sync.ts";
import { depsFor, fakeClock, newWorld, withState, type World } from "./fakes.ts";

const T0 = Date.parse("2026-01-01T12:00:00.000Z");
let state: ReturnType<typeof withState>;
let world: World;
beforeEach(() => {
  state = withState();
  world = newWorld();
  world.panes = [{ pane_id: "w8:p7", workspace_id: "w8", agent: "pi", agent_status: "idle" }];
  world.sessions = { "omo-delegate": [{ pane_id: "w15:p1", workspace_id: "w15", agent: "pi", agent_status: "working" }] };
});
afterEach(() => state.done());

const omo = { herdrSession: "omo-delegate", workspaces: ["w15"] };
const herdrCalls = () => world.calls.filter((c) => c[0] === "herdr");

test("sync run from a pane of another herdr session reads the configured session, so a live lane is not reported gone", async () => {
  const deps = depsFor(world, fakeClock(T0), state.dir, omo);
  await deps.registry.write({ key: "live-lane", title: "t", thread: "none", pane: "w15:p1", brief: "/b.md", done: "merged acme/app#1", openedAt: new Date(T0).toISOString() });
  const r = await syncRegistry(deps, false);
  expect(r.drift.filter((d) => d.includes("is gone"))).toEqual([]);
  expect(herdrCalls().length).toBeGreaterThan(0);
  expect(herdrCalls().every((c) => c[1] === "--session" && c[2] === "omo-delegate")).toBe(true);
});

test("a lead in another session does not hide this session's pane with the same id, from sync or dead-panes", async () => {
  world.sessions = { "omo-delegate": [{ pane_id: "w8:p7", workspace_id: "w8", agent: "pi", title: "stray" }] };
  const deps = depsFor(world, fakeClock(T0), state.dir, { herdrSession: "omo-delegate", leadPane: "w8:p7", leadSession: "default" });
  expect((await syncRegistry(deps, false)).unregistered.map((u) => u.pane)).toEqual(["w8:p7"]);
  world.screen = "omo has stopped\n$ ";
  const st = newDeadPaneState();
  const seen = new Set<string>();
  expect(await deadPaneTick(deps.run, deps.config, seen, "2026-01-01T12", st)).toEqual([]);
  expect(await deadPaneTick(deps.run, deps.config, seen, "2026-01-01T12", st)).toEqual(["DEAD_PANE w8:p7"]);
});

test("the launch footer tells the lane which herdr session its lead is in", async () => {
  const brief = join(state.dir, "brief.md");
  writeFileSync(brief, "# brief\n");
  const base = depsFor(world, fakeClock(T0), state.dir, { herdrSession: "omo-delegate", leadPane: "w8:p7", leadSession: "default" });
  const deps = { ...base, run: async (argv: readonly string[]) => {
    if (argv.join(" ").startsWith("herdr tab create")) return { code: 0, out: JSON.stringify({ result: { root_pane: { pane_id: "w15:p9" }, tab_id: "w15:t9" } }), err: "" };
    return base.run(argv);
  } };
  await launchLane(deps, { key: "new-lane", title: "t", brief, done: "closed acme/app#3" });
  expect(readFileSync(brief, "utf8")).toContain("sent to pane w8:p7 in herdr session default (herdr --session default pane send-text w8:p7");
});
