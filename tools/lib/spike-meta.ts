/**
 * Spike metadata block: the first lines of a spike script, between
 * `// spike-meta` and `// end-spike-meta`, one `// key: value` per line.
 */

export interface SpikeMeta {
  id: string;
  group: "A" | "B" | "I" | "J";
  cost: "none" | "low" | "medium";
  runBy: "loop" | "owner";
  agents: ("kiro" | "claude")[];
  /** 0 for none-cost spikes. */
  maxPrompts: number;
  maxWallSeconds: number;
  /** An estimate, never a measurement. */
  estimateCredits: { lo: number; hi: number } | null;
  /** Upper estimate, 0 when none. */
  claudePrompts: number;
  /** HS-S* ids. */
  human: string[];
  /** Spike ids. */
  depends: string[];
  /** Id whose session this spike reuses. */
  shares: string | null;
  allowAlways: "never" | "manual";
  /** Required (non-empty) when cost is not "none". */
  assumption: string;
}

export type ParseMetaResult = { ok: true; meta: SpikeMeta } | { ok: false; reason: string };

export const META_START = "// spike-meta";
export const META_END = "// end-spike-meta";
/** Only this many lines from the top of the file are read. */
export const META_MAX_LINES = 40;

/** Block key per field, in the order `formatMetaBlock` writes them. */
const KEYS = [
  "id",
  "group",
  "cost",
  "run-by",
  "agents",
  "max-prompts",
  "max-wall-seconds",
  "estimate-credits",
  "claude-prompts",
  "human",
  "depends",
  "shares",
  "allow-always",
  "assumption",
] as const;

type Key = (typeof KEYS)[number];

const ID_RE = /^[a-z][a-z0-9]*$/;
const HUMAN_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const NUM_RE = /^\d{1,9}$/;

function parseList(value: string): string[] | null {
  if (value === "") return [];
  const items = value.split(",").map((s) => s.trim());
  return items.some((s) => s === "") ? null : items;
}

class MetaError extends Error {}

function parseNum(key: Key, value: string): number {
  if (!NUM_RE.test(value)) throw new MetaError(`${key}: not a number: ${value}`);
  return Number(value);
}

function oneOf<T extends string>(key: Key, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new MetaError(`${key}: expected one of ${allowed.join(", ")}: ${value}`);
  }
  return value as T;
}

function listOf(key: Key, value: string): string[] {
  const items = parseList(value);
  if (items === null) throw new MetaError(`${key}: empty list item`);
  return items;
}

export function parseMetaBlock(fileText: string): ParseMetaResult {
  try {
    return parseChecked(fileText);
  } catch (e) {
    if (e instanceof MetaError) return { ok: false, reason: e.message };
    throw e;
  }
}

function parseChecked(fileText: string): ParseMetaResult {
  const lines = fileText.split(/\r?\n/).slice(0, META_MAX_LINES);
  const start = lines.findIndex((l) => l.trimEnd() === META_START);
  if (start < 0)
    return { ok: false, reason: `no metadata block in the first ${META_MAX_LINES} lines` };
  const end = lines.findIndex((l, i) => i > start && l.trimEnd() === META_END);
  if (end < 0) return { ok: false, reason: "metadata block is not closed" };

  const raw = new Map<Key, string>();
  for (const line of lines.slice(start + 1, end)) {
    const m = /^\/\/ ([a-z-]+):(?: (.*))?$/.exec(line.trimEnd());
    if (!m) return { ok: false, reason: `malformed line in metadata block: ${line}` };
    const key = m[1] as Key;
    if (!(KEYS as readonly string[]).includes(key))
      return { ok: false, reason: `unknown key: ${key}` };
    if (raw.has(key)) return { ok: false, reason: `duplicate key: ${key}` };
    raw.set(key, (m[2] ?? "").trim());
  }
  for (const key of KEYS) {
    if (!raw.has(key)) return { ok: false, reason: `missing required key: ${key}` };
  }
  const get = (key: Key): string => raw.get(key) ?? "";

  const id = get("id");
  if (!ID_RE.test(id)) return { ok: false, reason: `id: invalid spike id: ${id}` };
  const group = oneOf("group", get("group"), ["A", "B", "I", "J"] as const);
  const cost = oneOf("cost", get("cost"), ["none", "low", "medium"] as const);
  const runBy = oneOf("run-by", get("run-by"), ["loop", "owner"] as const);
  const allowAlways = oneOf("allow-always", get("allow-always"), ["never", "manual"] as const);
  const maxPrompts = parseNum("max-prompts", get("max-prompts"));
  const maxWallSeconds = parseNum("max-wall-seconds", get("max-wall-seconds"));
  const claudePrompts = parseNum("claude-prompts", get("claude-prompts"));

  const agentItems = listOf("agents", get("agents"));
  const human = listOf("human", get("human"));
  const depends = listOf("depends", get("depends"));
  const agents: ("kiro" | "claude")[] = [];
  for (const a of agentItems) {
    if (a !== "kiro" && a !== "claude") return { ok: false, reason: `agents: unknown agent: ${a}` };
    agents.push(a);
  }
  if (human.some((h) => !HUMAN_RE.test(h))) return { ok: false, reason: "human: invalid id" };
  if (depends.some((d) => !ID_RE.test(d)))
    return { ok: false, reason: "depends: invalid spike id" };

  let estimateCredits: SpikeMeta["estimateCredits"] = null;
  const est = get("estimate-credits");
  if (est !== "none") {
    const m = /^(\d{1,9})-(\d{1,9})$/.exec(est);
    if (!m) return { ok: false, reason: `estimate-credits: expected none or lo-hi: ${est}` };
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (lo > hi) return { ok: false, reason: `estimate-credits: lo is above hi: ${est}` };
    estimateCredits = { lo, hi };
  }

  const sharesRaw = get("shares");
  let shares: string | null = null;
  if (sharesRaw !== "none") {
    if (!ID_RE.test(sharesRaw))
      return { ok: false, reason: `shares: expected none or a spike id: ${sharesRaw}` };
    shares = sharesRaw;
  }

  const assumption = get("assumption");
  if (cost !== "none" && assumption === "") {
    return { ok: false, reason: "assumption: required when cost is not none" };
  }

  return {
    ok: true,
    meta: {
      id,
      group,
      cost,
      runBy,
      agents,
      maxPrompts: maxPrompts,
      maxWallSeconds: maxWallSeconds,
      estimateCredits,
      claudePrompts: claudePrompts,
      human,
      depends,
      shares,
      allowAlways,
      assumption,
    },
  };
}

export function formatMetaBlock(meta: SpikeMeta): string {
  const est = meta.estimateCredits
    ? `${meta.estimateCredits.lo}-${meta.estimateCredits.hi}`
    : "none";
  const rows: [Key, string][] = [
    ["id", meta.id],
    ["group", meta.group],
    ["cost", meta.cost],
    ["run-by", meta.runBy],
    ["agents", meta.agents.join(", ")],
    ["max-prompts", String(meta.maxPrompts)],
    ["max-wall-seconds", String(meta.maxWallSeconds)],
    ["estimate-credits", est],
    ["claude-prompts", String(meta.claudePrompts)],
    ["human", meta.human.join(", ")],
    ["depends", meta.depends.join(", ")],
    ["shares", meta.shares ?? "none"],
    ["allow-always", meta.allowAlways],
    ["assumption", meta.assumption],
  ];
  const body = rows.map(([k, v]) => (v === "" ? `// ${k}:` : `// ${k}: ${v}`));
  return `${[META_START, ...body, META_END].join("\n")}\n`;
}
