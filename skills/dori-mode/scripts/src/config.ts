import { homedir } from "node:os";
import { join } from "node:path";

export type ArgvTemplate = readonly string[];

export type Hooks = {
  readonly threadReply?: ArgvTemplate;
  readonly threadDone?: ArgvTemplate;
  readonly transcribe?: ArgvTemplate;
};

export type GuardThresholds = {
  readonly loadAlert: number;
  readonly loadOk: number;
  readonly memFreeMinPct: number;
  readonly diskFreeMinGb: number;
  readonly panesMax: number;
};

/** The coding agent lanes run on. It picks the launch command and where session files live. */
export type Agent = "omo" | "omp";

export type DoriConfig = {
  readonly agent: Agent;
  readonly stateDir: string;
  readonly laneWorkspace: string;
  readonly workspaces: readonly string[];
  readonly ignorePanes: readonly string[];
  readonly leadPane: string;
  readonly defaultCwd: string;
  readonly agentCommand: ArgvTemplate;
  readonly defaultModel: string;
  readonly launchKeywords: string;
  readonly sessionsDir: string;
  readonly nudgeAfterMin: number;
  readonly postAfterMin: number;
  readonly closeAfterMin: number;
  readonly heavySlots: number;
  readonly heavyMaxLoad: number;
  readonly deadPanePatterns: readonly string[];
  readonly guard: GuardThresholds;
  readonly hooks: Hooks;
};

/**
 * Per-agent defaults; explicit config fields still win. omp needs the omp-ulw extension for `ulw`, and
 * `--goal` so the lane starts with a native goal (omp creates none from a positional prompt).
 */
export const agentDefaults = (agent: Agent, home = homedir()): Pick<DoriConfig, "agentCommand" | "sessionsDir"> =>
  agent === "omp"
    ? { agentCommand: ["omp", "--model", "{model}", "--goal", "{prompt}"], sessionsDir: join(home, ".omp", "agent", "sessions") }
    : { agentCommand: ["omo", "--model", "{model}", "{prompt}"], sessionsDir: join(home, ".omo", "agent", "sessions") };

export const defaultConfig = (home = homedir(), agent: Agent = "omo"): DoriConfig => ({
  agent,
  stateDir: join(home, ".dori", "state"),
  laneWorkspace: "",
  workspaces: [],
  ignorePanes: [],
  leadPane: "",
  defaultCwd: home,
  ...agentDefaults(agent, home),
  defaultModel: "anthropic/claude-opus-5-5",
  launchKeywords: "ulw set goal and work",
  nudgeAfterMin: 15,
  postAfterMin: 20,
  closeAfterMin: 5,
  heavySlots: 1,
  heavyMaxLoad: 80,
  deadPanePatterns: ["has stopped", "no suitable jobs"],
  guard: { loadAlert: 150, loadOk: 80, memFreeMinPct: 20, diskFreeMinGb: 50, panesMax: 20 },
  hooks: {},
});

export const configPath = (): string => process.env.DORI_CONFIG ?? join(homedir(), ".dori", "config.json");

export const expandHome = (path: string, home = homedir()): string => (path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path);

export const loadConfig = async (path = configPath(), home = homedir()): Promise<DoriConfig> => {
  const file = Bun.file(path);
  const raw = (await file.exists()) ? ((await file.json()) as Partial<DoriConfig>) : {};
  const agent = raw.agent ?? "omo";
  if (agent !== "omo" && agent !== "omp") throw new Error(`config agent must be "omo" or "omp", got ${JSON.stringify(agent)}`);
  const base = defaultConfig(home, agent);
  const merged: DoriConfig = { ...base, ...raw, guard: { ...base.guard, ...raw.guard }, hooks: { ...base.hooks, ...raw.hooks } };
  return {
    ...merged,
    stateDir: expandHome(process.env.DORI_STATE_DIR ?? merged.stateDir, home),
    defaultCwd: expandHome(merged.defaultCwd, home),
    sessionsDir: expandHome(merged.sessionsDir, home),
    leadPane: process.env.DORI_LEAD_PANE ?? merged.leadPane,
  };
};

export const fill = (template: ArgvTemplate, values: Readonly<Record<string, string>>): string[] =>
  template.map((part) => part.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole));
