import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { loadConfig } from "../src/config.ts";
import { watchTick } from "../src/done-flow.ts";
import { freshnessTick } from "../src/freshness.ts";
import { Registry } from "../src/registry.ts";
import { syncRegistry } from "../src/sync.ts";
import { depsFor, fakeClock, newWorld, sent, withState, type World } from "./fakes.ts";

const T0 = Date.parse("2026-01-01T12:00:00.000Z");
let own: ReturnType<typeof withState>;
let peer: ReturnType<typeof withState>;
let world: World;
beforeEach(() => {
  own = withState();
  peer = withState();
  world = newWorld();
  world.panes = [{ pane_id: "w15:p1", workspace_id: "w15", agent: "pi", agent_status: "idle", title: "peer lane screen" }];
});
afterEach(() => {
  own.done();
  peer.done();
});

const lane = (key: string, extra: Record<string, unknown> = {}) => ({ key, title: "t", thread: "chan/1", pane: "w15:p1", session: "s-1", brief: "/b.md", done: "merged acme/app#1", openedAt: new Date(T0 - 3_600_000).toISOString(), ...extra });

const writePeer = async () => {
  const reg = new Registry(peer.dir);
  await reg.write(lane("peer-open"));
  await reg.write(lane("peer-closed", { closedAt: new Date(T0).toISOString() }));
  return snapshot();
};
const snapshot = () => Object.fromEntries(readdirSync(join(peer.dir, "lanes")).map((f) => [f, readFileSync(join(peer.dir, "lanes", f), "utf8")]));

test("sync lists a peer instance's open lanes marked peer, and --write leaves its files byte-identical", async () => {
  const before = await writePeer();
  const deps = depsFor(world, fakeClock(T0), own.dir, { peerStateDirs: [peer.dir] });
  for (const write of [false, true]) {
    const r = await syncRegistry(deps, write);
    expect(r.peers).toEqual([{ key: "peer-open", thread: "chan/1", pane: "w15:p1", session: "s-1", status: "peer:working" }]);
    expect(r.rows).toEqual([]);
    expect(r.drift).toEqual([]);
  }
  expect(snapshot()).toEqual(before);
});

test("a missing peer directory is no lanes and is not created; an unparsable peer lane is reported, not fatal", async () => {
  const missing = join(peer.dir, "not-there");
  const deps = depsFor(world, fakeClock(T0), own.dir, { peerStateDirs: [missing, peer.dir] });
  mkdirSync(join(peer.dir, "lanes"), { recursive: true });
  writeFileSync(join(peer.dir, "lanes", "broken.json"), "{");
  const r = await syncRegistry(deps, true);
  expect(r.peers).toEqual([]);
  expect(r.peerUnreadable).toEqual([join(peer.dir, "lanes", "broken.json")]);
  expect(existsSync(missing)).toBe(false);
});

test("watch and freshness never close, nudge or post for a peer lane", async () => {
  const before = await writePeer();
  const deps = depsFor(world, fakeClock(T0), own.dir, { peerStateDirs: [peer.dir], hooks: { threadReply: ["notify", "{thread}", "{text}"] } });
  await watchTick(deps);
  await freshnessTick(deps, own.dir);
  expect(sent(world)).toEqual([]);
  expect(world.calls.filter((c) => c[0] === "notify")).toEqual([]);
  expect(snapshot()).toEqual(before);
});

test("peerStateDirs expands ~, defaults to none, and refuses this instance's own stateDir", async () => {
  const path = join(own.dir, "c.json");
  expect((await loadConfig("/nonexistent/config.json", "/home/ana")).peerStateDirs).toEqual([]);
  await Bun.write(path, JSON.stringify({ stateDir: "~/.dori/state-omo", peerStateDirs: ["~/.dori/state-omp"] }));
  expect((await loadConfig(path, "/home/ana")).peerStateDirs).toEqual(["/home/ana/.dori/state-omp"]);
  await Bun.write(path, JSON.stringify({ stateDir: "~/.dori/state-omo", peerStateDirs: ["/home/ana/.dori/state-omo"] }));
  await expect(loadConfig(path, "/home/ana")).rejects.toThrow("config peerStateDirs lists this instance's own stateDir");
});

test("peerStateDirs refuses this instance's own stateDir under any spelling: slash, dot segments, relative path, symlink, even before it exists", async () => {
  const path = join(own.dir, "c.json");
  const link = join(peer.dir, "link");
  symlinkSync(own.dir, link);
  const refusal = "config peerStateDirs lists this instance's own stateDir";
  for (const spelling of [`${own.dir}/`, `${own.dir}/x/..`, relative(process.cwd(), own.dir), link, `${link}/`]) {
    await Bun.write(path, JSON.stringify({ stateDir: own.dir, peerStateDirs: [spelling] }));
    await expect(loadConfig(path, "/home/ana")).rejects.toThrow(refusal);
  }
  const future = join(own.dir, "not-yet");
  await Bun.write(path, JSON.stringify({ stateDir: future, peerStateDirs: [join(link, "not-yet")] }));
  await expect(loadConfig(path, "/home/ana")).rejects.toThrow(refusal);
  expect(existsSync(future)).toBe(false);
  await Bun.write(path, JSON.stringify({ stateDir: own.dir, peerStateDirs: [peer.dir] }));
  expect((await loadConfig(path, "/home/ana")).peerStateDirs).toEqual([peer.dir]);
});

test("a peer lane that is not a lane, or a peer lanes path that cannot be listed, is reported without breaking own sync or the other peers", async () => {
  await new Registry(own.dir).write(lane("own-lane"));
  await new Registry(peer.dir).write(lane("peer-open"));
  const lanes = join(peer.dir, "lanes");
  const bad = { "null.json": "null", "array.json": "[]", "number.json": "7", "nokey.json": '{"thread":"chan/1"}', "nothread.json": '{"key":"k"}' };
  for (const [f, body] of Object.entries(bad)) writeFileSync(join(lanes, f), body);
  const fileLanes = join(peer.dir, "file-peer");
  mkdirSync(fileLanes);
  writeFileSync(join(fileLanes, "lanes"), "not a directory");
  const deps = depsFor(world, fakeClock(T0), own.dir, { peerStateDirs: [fileLanes, peer.dir] });
  const r = await syncRegistry(deps, true);
  expect(r.rows.map((x) => x.key)).toEqual(["own-lane"]);
  expect(r.peers.map((x) => x.key)).toEqual(["peer-open"]);
  expect([...r.peerUnreadable].sort()).toEqual([join(fileLanes, "lanes"), ...Object.keys(bad).map((f) => join(lanes, f))].sort());
});
