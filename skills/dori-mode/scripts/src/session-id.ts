import { readdirSync } from "node:fs";
import { join } from "node:path";

import type { Runner } from "./run.ts";

export type Proc = { readonly pid: number; readonly ppid: number; readonly cmd: string };
export type SessionHit = { readonly id: string; readonly via: "argv" | "child-env" | "start-time" | "none"; readonly pid?: number };

// omo runs as senpi's bundled cli.js or the `omo` launcher; omp is one compiled `omp` binary. Both set PI_SESSION_ID for children.
const AGENT = /senpi\/dist\/bundle\/cli\.js|(^|\/)om[op](\s|$)/;
const ENV_ID = /(?:^|\s)PI_SESSION_ID=([0-9a-f-]{36})(?:\s|$)/;
// A provider bridge (a Claude-subscription lane runs `claude --output-format stream-json`) holds no session of its own.
const PROVIDER_BRIDGE = /(^|\/)claude\s.*--output-format[= ]stream-json/;
const SESSION_FILE = /^(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d{3})Z_([0-9a-f-]{36})\.jsonl$/;
const START_WINDOW_MS = 180_000;

export const procTable = async (run: Runner): Promise<Proc[]> =>
  (await run(["ps", "-A", "-o", "pid=,ppid=,command="])).out.split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] ?? "" }] : [];
  });

const descendants = (table: readonly Proc[], root: number): Proc[] => {
  const byParent = new Map<number, Proc[]>();
  for (const p of table) byParent.set(p.ppid, [...(byParent.get(p.ppid) ?? []), p]);
  const out: Proc[] = [];
  const queue = [...(byParent.get(root) ?? [])];
  for (let p = queue.shift(); p; p = queue.shift()) {
    out.push(p);
    queue.push(...(byParent.get(p.pid) ?? []));
  }
  return out;
};

export const sessionDirFor = (sessionsDir: string, cwd: string): string => join(sessionsDir, `--${cwd.replace(/^\//, "").replace(/\//g, "-")}--`);

export type SessionDeps = { readonly run: Runner; readonly sessionsDir: string; readonly listDir?: (dir: string) => readonly string[] };

export const resolveSession = async (pane: string, cwd: string, table: readonly Proc[], deps: SessionDeps): Promise<SessionHit> => {
  const info = await deps.run(["herdr", "pane", "process-info", "--pane", pane]);
  const shellPid = info.code === 0 ? Number((JSON.parse(info.out) as { result?: { process_info?: { shell_pid?: number } } }).result?.process_info?.shell_pid ?? 0) : 0;
  const agent = shellPid ? descendants(table, shellPid).find((p) => AGENT.test(p.cmd) && !/\bmcp\b/.test(p.cmd)) : undefined;
  if (!agent) return { id: "", via: "none" };
  const argv = agent.cmd.split(/\s+/);
  const flagAt = argv.indexOf("--session");
  const fromFlag = flagAt >= 0 ? (argv[flagAt + 1] ?? "") : "";
  if (fromFlag) return { id: fromFlag, via: "argv", pid: agent.pid };
  const envId = async (pid: number) => ENV_ID.exec((await deps.run(["ps", "eww", "-o", "command=", "-p", String(pid)])).out)?.[1];
  // The agent's own launch environment can carry the PI_SESSION_ID of whoever launched it (a lead), and children that
  // only inherit it carry the same value. Only an id the agent set itself, so one that differs, names its session.
  const inherited = await envId(agent.pid);
  for (const child of descendants(table, agent.pid).filter((p) => !PROVIDER_BRIDGE.test(p.cmd)).slice(0, 40)) {
    const id = await envId(child.pid);
    if (id && id !== inherited) return { id, via: "child-env", pid: agent.pid };
  }
  const started = Date.parse((await deps.run(["ps", "-o", "lstart=", "-p", String(agent.pid)])).out);
  if (Number.isNaN(started)) return { id: "", via: "none", pid: agent.pid };
  const list = deps.listDir ?? ((d: string) => { try { return readdirSync(d); } catch { return []; } });
  const near = list(sessionDirFor(deps.sessionsDir, cwd)).flatMap((name) => {
    const m = SESSION_FILE.exec(name);
    const at = m ? Date.parse(`${m[1]}:${m[2]}:${m[3]}.${m[4]}Z`) : Number.NaN;
    return m?.[5] && at >= started - 5_000 && at <= started + START_WINDOW_MS ? [{ id: m[5], at }] : [];
  });
  // Two lanes started close together in one directory both have a file in the window; neither can be told apart by time,
  // so only a single candidate names this lane's session, and an ambiguous window stays unresolved.
  return near.length === 1 && near[0] ? { id: near[0].id, via: "start-time", pid: agent.pid } : { id: "", via: "none", pid: agent.pid };
};
