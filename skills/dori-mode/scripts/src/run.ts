export type Ran = { readonly code: number; readonly out: string; readonly err: string };
export type RunOptions = { readonly cwd?: string; readonly timeoutMs?: number };
export type Runner = (argv: readonly string[], opts?: RunOptions) => Promise<Ran>;

export const run: Runner = async (argv, opts = {}) => {
  let p: ReturnType<typeof Bun.spawn>;
  try {
    p = Bun.spawn([...argv], { stdout: "pipe", stderr: "pipe", ...(opts.cwd ? { cwd: opts.cwd } : {}), ...(opts.timeoutMs ? { timeout: opts.timeoutMs, killSignal: "SIGKILL" } : {}) });
  } catch (e) {
    return { code: 127, out: "", err: e instanceof Error ? e.message : String(e) };
  }
  const [out, err, code] = await Promise.all([new Response(p.stdout as ReadableStream).text(), new Response(p.stderr as ReadableStream).text(), p.exited]);
  return { code: p.signalCode ? 124 : code, out: out.trim(), err: (p.signalCode ? `killed by ${p.signalCode} (timeout)` : err).trim() };
};

/**
 * Sends every herdr call to one named session. `--session` wins over HERDR_SOCKET_PATH and HERDR_SESSION in the caller's
 * environment, so a Dori started from a pane of another session still lists and drives its own lanes. Empty: unchanged.
 */
export const pinHerdrSession = (inner: Runner, session: string): Runner =>
  session ? (argv, opts) => inner(argv[0] === "herdr" ? ["herdr", "--session", session, ...argv.slice(1)] : argv, opts) : inner;

export type Clock = { readonly now: () => number; readonly sleep: (ms: number) => Promise<void> };
export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => Bun.sleep(ms) };

export const iso = (clock: Clock): string => new Date(clock.now()).toISOString();
