import { existsSync, realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type buildChildEnv, type EnvProfile, isPaneEnvName } from "./env.ts";
import { readHcVersion } from "./hc.ts";
import { scanSpikeTree } from "./no-direct-hc.ts";
import { pidAlive, readMarker } from "./own-marker.ts";

export interface PreflightInput {
  mode: "normal";
  q: string;
  env: Readonly<Record<string, string | undefined>>;
  session: string;
  root: string;
  realRoot: string;
  stateHome: string;
  configHome: string;
  realStateHome: string;
  realConfigHome: string;
  hcSocketVar: string | null;
  socketPaths: string[];
  defaultStateDir: string;
  envHome: string | undefined;
  realHome: string;
  hcVersion: string | null;
  needsHcAtLeast: [number, number, number];
  rootState:
    | { kind: "absent" }
    | { kind: "stale"; markerOk: boolean }
    | { kind: "live" }
    | { kind: "foreign" };
  scriptTreeViolations: string[];
}

export type PfId =
  | "PF-SESSION"
  | "PF-XDG"
  | "PF-SOCKLEN"
  | "PF-DEFAULT-PATH"
  | "PF-HOME"
  | "PF-VERSION"
  | "PF-ROOT"
  | "PF-WRAPPER"
  | "PF-CHILD-ENV"
  | "PF-PANE-ENV";

export interface PreflightDeps {
  buildChildEnv: typeof buildChildEnv;
}

export interface PreflightReport {
  ok: boolean;
  failures: { id: PfId; criterion: string }[];
}

export const SESSION_RE = /^wsp(-[a-z0-9]{1,8})?$/;
export const SOCKET_LIMIT = 90;
export const LONGEST_SOCKET_NAME = 40;

const PANE_NAMES = ["HC_SCOPE", "HC_TERMINAL_ID", "HC_TERMINAL_SOCKET"] as const;
const PROFILES: readonly EnvProfile[] = ["hc", "agent", "listener", "tool"];
const ALLOWED_ROOTS = ["/tmp/hcw", "/private/tmp/hcw"] as const;

/** Resolves `.`, `..` and empty segments. Paths are treated as absolute; `..` stops at the top. */
function segments(p: string): string[] {
  const out: string[] = [];
  for (const s of p.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  return out;
}

/** Segment-wise strict prefix after normalisation; never `startsWith` on text. */
export function isUnder(root: string, p: string): boolean {
  const r = segments(root);
  const c = segments(p);
  if (c.length <= r.length) return false;
  return r.every((s, k) => c[k] === s);
}

function isSameOrUnder(root: string, p: string): boolean {
  return isUnder(root, p) || segments(root).join("/") === segments(p).join("/");
}

const VERSION_RE = /^[A-Za-z][\w.-]* (\d{1,9})\.(\d{1,9})\.(\d{1,9})$/;

/** Parses `<name> a.b.c` (surrounding whitespace allowed). Anything else is `null`. */
export function parseHcVersion(text: string): [number, number, number] | null {
  const m = VERSION_RE.exec(text.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Lexicographic numeric tuple comparison: `a >= b`. */
export function versionAtLeast(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): boolean {
  for (let k = 0; k < 3; k++) {
    const x = a[k] as number;
    const y = b[k] as number;
    if (x !== y) return x > y;
  }
  return true;
}

/** Runs every check independently so the report lists all failures. Writes nothing. */
export function runPreflight(i: PreflightInput, deps: PreflightDeps): PreflightReport {
  const failures: PreflightReport["failures"] = [];
  const fail = (id: PfId, criterion: string): void => {
    failures.push({ id, criterion });
  };

  if (!SESSION_RE.test(i.session) || i.session === "default") {
    fail("PF-SESSION", "R2.2 session must match wsp(-[a-z0-9]{1,8})? and never be default");
  }

  const xdgOk = (set: string, real: string): boolean =>
    set !== "" && real !== "" && ALLOWED_ROOTS.some((r) => isUnder(r, real));
  if (!xdgOk(i.stateHome, i.realStateHome) || !xdgOk(i.configHome, i.realConfigHome)) {
    fail("PF-XDG", "R2.3 both XDG homes set and under /tmp/hcw/ or /private/tmp/hcw/");
  }

  if (i.socketPaths.some((p) => Buffer.byteLength(p, "utf8") > SOCKET_LIMIT)) {
    fail("PF-SOCKLEN", "R2.4 every socket path at most 90 bytes");
  }

  if (i.socketPaths.some((p) => isSameOrUnder(i.defaultStateDir, p))) {
    fail("PF-DEFAULT-PATH", "R2.5 no socket path equal to or under the default state directory");
  }

  if (i.envHome === undefined || i.envHome !== i.realHome) {
    fail("PF-HOME", "R2.6 HOME equals the real home directory");
  }

  const parsed = i.hcVersion === null ? null : parseHcVersion(i.hcVersion);
  if (parsed === null || !versionAtLeast(parsed, i.needsHcAtLeast)) {
    fail("PF-VERSION", "R2.7 hc version parseable and at least the minimum");
  }

  const rs = i.rootState;
  if (!(rs.kind === "absent" || (rs.kind === "stale" && rs.markerOk))) {
    fail("PF-ROOT", "R2.8 root absent, or stale with a valid marker; never live or foreign");
  }

  if (i.scriptTreeViolations.length > 0) {
    fail("PF-WRAPPER", "R2.10 no direct hc use in the spike script tree");
  }

  const outputs = PROFILES.map((profile) =>
    deps.buildChildEnv({
      base: i.env,
      profile,
      // The builder refuses an empty value; an invalid session is reported by PF-SESSION.
      session: i.session === "" ? "-" : i.session,
      root: i.root === "" ? "-" : i.root,
      extraPass: Object.keys(i.env),
    }),
  );
  const socketOk =
    i.hcSocketVar === null || isUnder(i.realRoot, i.hcSocketVar) || isUnder(i.root, i.hcSocketVar);
  const childBad = outputs.some((o) =>
    Object.keys(o).some((k) => {
      if ((PANE_NAMES as readonly string[]).includes(k)) return false;
      if (k === "HC_SESSION") return false;
      if (k === "HC_SOCKET") return !socketOk;
      return isPaneEnvName(k);
    }),
  );
  if (childBad || !socketOk) {
    fail("PF-CHILD-ENV", "R2.13 child environments carry no HC_*/HERDR_* except HC_SESSION");
  }

  if (outputs.some((o) => PANE_NAMES.some((n) => Object.hasOwn(o, n)))) {
    fail("PF-PANE-ENV", "R2.14, R2.15 pane variables never reach a child environment");
  }

  return { ok: failures.length === 0, failures };
}

/** Prints criterion ids and only HC_SESSION, the XDG paths and HC_SOCKET. */
export function formatPreflight(r: PreflightReport, i: PreflightInput): string {
  const lines: string[] = [r.ok ? "preflight: PASS" : "preflight: FAIL"];
  for (const f of r.failures) lines.push(`  ${f.id}: ${f.criterion}`);
  lines.push(`  HC_SESSION=${i.session}`);
  lines.push(`  XDG_STATE_HOME=${i.stateHome}`);
  lines.push(`  XDG_CONFIG_HOME=${i.configHome}`);
  if (i.hcSocketVar !== null) lines.push(`  HC_SOCKET=${i.hcSocketVar}`);
  return `${lines.join("\n")}\n`;
}

export interface GatherOptions {
  /** Parent of the Spike_Root. Default `/tmp/hcw`; tests pass a folder under `os.tmpdir()`. */
  rootPrefix?: string;
  /** Repo root scanned for direct `hc` use. Default: the repo containing this file. */
  repoRoot?: string;
}

/** Realpath of the nearest existing ancestor plus the missing tail. */
function realpathLoose(p: string): string {
  const tail: string[] = [];
  let cur = resolve(p);
  while (!existsSync(cur)) {
    const up = dirname(cur);
    if (up === cur) break;
    tail.unshift(cur.slice(up.length + 1));
    cur = up;
  }
  return join(realpathSync(cur), ...tail);
}

/**
 * Collects the inputs of `runPreflight`. Session is `wsp-<q>` (A6: `q` is the first id of the
 * batch). Runs only `hc --version` (through `readHcVersion`), opens no socket, writes nothing.
 */
export async function gatherPreflightInput(
  q: string,
  env: NodeJS.ProcessEnv,
  opts: GatherOptions = {},
): Promise<PreflightInput> {
  const session = `wsp-${q}`;
  const root = join(opts.rootPrefix ?? "/tmp/hcw", q);
  const realRoot = realpathLoose(root);
  const realHome = realpathLoose(userInfo().homedir);
  const marker = readMarker(root);
  let rootState: PreflightInput["rootState"];
  if (!existsSync(root)) rootState = { kind: "absent" };
  else if (marker === null) rootState = { kind: "foreign" };
  else if (pidAlive(marker.runnerPid)) rootState = { kind: "live" };
  else rootState = { kind: "stale", markerOk: true };
  const version = await readHcVersion(env);
  const repoRoot = opts.repoRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  return {
    mode: "normal",
    q,
    env,
    session,
    root,
    realRoot,
    stateHome: join(root, "s"),
    configHome: join(root, "c"),
    realStateHome: join(realRoot, "s"),
    realConfigHome: join(realRoot, "c"),
    hcSocketVar: env.HC_SOCKET ?? null,
    socketPaths: [join(realRoot, "s", "herdr-core", session, "x".repeat(LONGEST_SOCKET_NAME))],
    defaultStateDir: join(realHome, ".local", "state", "herdr-core", "default"),
    envHome: env.HOME,
    realHome,
    hcVersion: version === null ? null : `hc ${version}`,
    needsHcAtLeast: q === "q1" ? [0, 1, 17] : [0, 1, 18],
    rootState,
    scriptTreeViolations: scanSpikeTree(repoRoot),
  };
}
