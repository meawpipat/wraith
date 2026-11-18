import type { Finding } from "./finding.ts";
import { GATE_LIST } from "./spike-ids.ts";

/** Parser, renderer and checker for `docs/spikes/RESULTS.md` (design: "RESULTS tooling"). */

export type ResultValue = "PASS" | "FAIL" | "PARTIAL" | "pending";
export type Notify = "yes" | "no" | "n/a";

export interface ResultsEntry {
  id: string;
  question: string;
  experiment: string;
  result: ResultValue;
  reason?: string;
  /** Repo-relative posix paths. */
  evidence: string[];
  branch: string;
  affects: string[];
  notify: Notify;
  openHumanSteps: string[];
  notes: string[];
}

export interface ParseError {
  /** 1-based line. */
  line: number;
  message: string;
}

export interface TableRow {
  /** Spike id as written in the first cell, for example `Q3b`. */
  id: string;
  /** 1-based line. */
  line: number;
  /** Lower-cased, trimmed header cells of the nearest header row. */
  header: string[];
  /** Trimmed cells. */
  cells: string[];
}

export interface CheckOptions {
  repoRoot: string;
  exists: (p: string) => boolean;
  gate: boolean;
}

export const RESULTS_FILE = "docs/spikes/RESULTS.md";

const RESULT_VALUES: readonly ResultValue[] = ["PASS", "FAIL", "PARTIAL", "pending"];
const NOTIFY_VALUES: readonly Notify[] = ["yes", "no", "n/a"];
const LABELS = [
  "Question",
  "Experiment",
  "Result",
  "Reason",
  "Evidence",
  "Branch chosen",
  "Affects",
  "Notify",
  "Open human steps",
  "Notes",
] as const;
const REQUIRED_LABELS = LABELS.filter((l) => l !== "Reason" && l !== "Notes");
const PRECHECK_PREFIX = "pre-check note, context only: ";

// ---------------------------------------------------------------- render

export function renderEntry(e: ResultsEntry): string {
  const out: string[] = [`### ${e.id}`];
  out.push(`- **Question:** ${e.question}`);
  out.push(`- **Experiment:** ${e.experiment}`);
  out.push(`- **Result:** ${e.result}`);
  if (e.reason !== undefined) out.push(`- **Reason:** ${e.reason}`);
  out.push(
    `- **Evidence:** ${e.evidence.length === 0 ? "none" : e.evidence.map((p) => `\`${p}\``).join("; ")}`,
  );
  out.push(`- **Branch chosen:** ${e.branch === "" ? "none" : e.branch}`);
  out.push(`- **Affects:** ${e.affects.length === 0 ? "none" : e.affects.join(", ")}`);
  out.push(`- **Notify:** ${e.notify}`);
  if (e.openHumanSteps.length === 0) out.push("- **Open human steps:** none");
  else {
    out.push("- **Open human steps:**");
    for (const s of e.openHumanSteps) out.push(`  - ${s}`);
  }
  if (e.notes.length > 0) {
    out.push("- **Notes:**");
    for (const n of e.notes) out.push(`  - ${n}`);
  }
  return `${out.join("\n")}\n`;
}

// ----------------------------------------------------------------- parse

const ID_RE = /^Q\d+[a-z]?$/i;
const FIELD_RE = /^- \*\*([^*:]+):\*\* ?(.*)$/;
const SUB_RE = /^\s+- (.*)$/;
const ENTRIES_HEADING = /^##\s+Entries\s*$/i;

interface Located {
  entry: ResultsEntry;
  line: number;
}

interface Doc {
  entries: Located[];
  tables: TableRow[];
  errors: ParseError[];
}

function splitList(value: string, sep: string): string[] {
  const v = value.trim();
  if (v === "" || v === "none") return [];
  return v
    .split(sep)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function stripTicks(s: string): string {
  return s.startsWith("`") && s.endsWith("`") && s.length >= 2 ? s.slice(1, -1) : s;
}

/** Index range [start, end) of the lines scanned for entries. */
function entryScope(lines: readonly string[]): { start: number; end: number; hasSection: boolean } {
  const h = lines.findIndex((l) => ENTRIES_HEADING.test(l));
  if (h < 0) return { start: 0, end: lines.length, hasSection: false };
  let end = lines.length;
  for (let i = h + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  return { start: h + 1, end, hasSection: true };
}

function parseBlock(
  lines: readonly string[],
  first: number,
  id: string,
  errors: ParseError[],
): ResultsEntry | null {
  const fields = new Map<string, { inline: string; subs: string[] }>();
  let current: { inline: string; subs: string[] } | undefined;
  for (let i = 1; i < lines.length; i++) {
    const text = lines[i] ?? "";
    const lineNo = first + i + 1;
    if (text.trim() === "") continue;
    const f = FIELD_RE.exec(text);
    if (f) {
      const label = (f[1] ?? "").trim();
      if (!(LABELS as readonly string[]).includes(label)) {
        errors.push({ line: lineNo, message: `unknown field in ${id}` });
        current = undefined;
        continue;
      }
      if (fields.has(label)) {
        errors.push({ line: lineNo, message: `duplicate field ${label} in ${id}` });
        current = undefined;
        continue;
      }
      current = { inline: (f[2] ?? "").trim(), subs: [] };
      fields.set(label, current);
      continue;
    }
    const s = SUB_RE.exec(text);
    if (s && current) {
      current.subs.push((s[1] ?? "").trim());
      continue;
    }
    errors.push({ line: lineNo, message: `unexpected line in ${id}` });
  }
  let ok = true;
  for (const label of REQUIRED_LABELS) {
    if (!fields.has(label)) {
      errors.push({ line: first + 1, message: `missing field ${label} in ${id}` });
      ok = false;
    }
  }
  const resultRaw = fields.get("Result")?.inline ?? "";
  const result = RESULT_VALUES.find((r) => r === resultRaw);
  if (fields.has("Result") && result === undefined) {
    errors.push({ line: first + 1, message: `bad Result value in ${id}` });
    ok = false;
  }
  const notifyRaw = fields.get("Notify")?.inline ?? "";
  const notify = NOTIFY_VALUES.find((n) => n === notifyRaw);
  if (fields.has("Notify") && notify === undefined) {
    errors.push({ line: first + 1, message: `bad Notify value in ${id}` });
    ok = false;
  }
  if (!ok || result === undefined || notify === undefined) return null;
  const listOf = (label: string): string[] => {
    const f = fields.get(label);
    if (!f) return [];
    if (f.subs.length > 0) return f.subs;
    return f.inline === "" || f.inline === "none" ? [] : [f.inline];
  };
  const branchRaw = fields.get("Branch chosen")?.inline ?? "";
  const entry: ResultsEntry = {
    id,
    question: fields.get("Question")?.inline ?? "",
    experiment: fields.get("Experiment")?.inline ?? "",
    result,
    evidence: splitList(fields.get("Evidence")?.inline ?? "", ";").map(stripTicks),
    branch: branchRaw === "none" ? "" : branchRaw,
    affects: splitList(fields.get("Affects")?.inline ?? "", ","),
    notify,
    openHumanSteps: listOf("Open human steps"),
    notes: listOf("Notes"),
  };
  const reason = fields.get("Reason")?.inline;
  if (reason !== undefined) entry.reason = reason;
  return entry;
}

function splitCells(line: string): string[] {
  return line.split(/(?<!\\)\|/);
}

function parseTables(lines: readonly string[]): TableRow[] {
  const rows: TableRow[] = [];
  let header: string[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? "";
    if (!text.startsWith("|")) {
      header = null;
      continue;
    }
    const next = lines[i + 1] ?? "";
    if (/^\|[\s:|-]+\|?\s*$/.test(next) && next.includes("-") && !/^\|[\s:|-]+\|?\s*$/.test(text)) {
      header = splitCells(text)
        .slice(1, -1)
        .map((c) => c.trim().toLowerCase());
      continue;
    }
    if (/^\|[\s:|-]+\|?\s*$/.test(text)) continue;
    if (header === null) continue;
    const cells = splitCells(text)
      .slice(1, -1)
      .map((c) => c.trim());
    const m = /^(Q\d+[a-z]?)\b/i.exec(cells[0] ?? "");
    if (m?.[1] === undefined) continue;
    rows.push({ id: m[1], line: i + 1, header, cells });
  }
  return rows;
}

function parseDoc(md: string): Doc {
  const lines = md.split("\n");
  const errors: ParseError[] = [];
  const entries: Located[] = [];
  const { start, end } = entryScope(lines);
  const heads: number[] = [];
  for (let i = start; i < end; i++) if (/^### /.test(lines[i] ?? "")) heads.push(i);
  const seen = new Set<string>();
  heads.forEach((h, k) => {
    const title = (lines[h] ?? "").slice(4).trim();
    if (!ID_RE.test(title)) return;
    const stop = heads[k + 1] ?? end;
    const block = lines.slice(h, stop);
    const entry = parseBlock(block, h, title, errors);
    if (seen.has(title.toLowerCase())) {
      errors.push({ line: h + 1, message: `duplicate entry ${title}` });
      return;
    }
    seen.add(title.toLowerCase());
    if (entry) entries.push({ entry, line: h + 1 });
  });
  return { entries, tables: parseTables(lines), errors };
}

export function parseResults(md: string): {
  entries: ResultsEntry[];
  tables: TableRow[];
  errors: ParseError[];
} {
  const d = parseDoc(md);
  return { entries: d.entries.map((x) => x.entry), tables: d.tables, errors: d.errors };
}

// ---------------------------------------------------------------- upsert

function colIndex(header: readonly string[], key: string): number {
  return header.findIndex((h) => h.startsWith(key));
}

function resultToken(cell: string): string {
  const m = /^(PASS|FAIL|PARTIAL|pending|todo)\b/i.exec(cell.trim());
  return (m?.[1] ?? "").toLowerCase();
}

function evidenceCell(e: ResultsEntry): string {
  return e.evidence.map((p) => `\`${p}\``).join("; ");
}

/** Sets the `result|status|evidence|branch|date` cells of one table row; other bytes stay. */
function rewriteRow(
  line: string,
  header: readonly string[],
  e: ResultsEntry,
  today: string,
): string {
  const raw = splitCells(line);
  const pending = e.result === "pending";
  const set = (key: string, value: string): void => {
    const i = colIndex(header, key);
    if (i < 0) return;
    const at = i + 1;
    if (at >= raw.length - 1) return;
    raw[at] = value === "" ? " " : ` ${value} `;
  };
  set("result", pending ? "pending" : `${e.result} (entry)`);
  set("status", pending ? "todo" : "done");
  set("evidence", pending ? "" : evidenceCell(e));
  set("branch", pending ? "" : e.branch);
  set("date", pending ? "" : today);
  return raw.join("|");
}

export function upsertEntry(md: string, e: ResultsEntry, today: string): string {
  const lines = md.split("\n");
  const tables = parseTables(lines);
  const entry: ResultsEntry = { ...e, notes: [...e.notes] };
  const idKey = e.id.toLowerCase();
  for (const row of tables) {
    if (row.id.toLowerCase() !== idKey) continue;
    const ri = colIndex(row.header, "result");
    const old = ri >= 0 ? (row.cells[ri] ?? "") : "";
    const m = /^pending\s*·\s*(.+)$/i.exec(old);
    const note = m?.[1]?.trim();
    if (note !== undefined && note !== "") {
      const text = `${PRECHECK_PREFIX}${note}`;
      if (!entry.notes.includes(text)) entry.notes.push(text);
    }
  }
  const previous = parseDoc(md).entries.find((x) => x.entry.id.toLowerCase() === idKey)?.entry;
  for (const n of previous?.notes ?? []) {
    if (n.startsWith(PRECHECK_PREFIX) && !entry.notes.includes(n)) entry.notes.push(n);
  }
  for (const row of tables) {
    if (row.id.toLowerCase() !== idKey) continue;
    const at = row.line - 1;
    lines[at] = rewriteRow(lines[at] ?? "", row.header, entry, today);
  }
  const block = renderEntry(entry).trimEnd().split("\n");
  const scope = entryScope(lines);
  if (!scope.hasSection) {
    while (lines.length > 0 && (lines[lines.length - 1] ?? "") === "") lines.pop();
    const head = lines.length > 0 ? [...lines, ""] : [];
    return `${[...head, "## Entries", "", ...block].join("\n")}\n`;
  }
  const head = lines.slice(0, scope.start);
  const tail = lines.slice(scope.end);
  const body = lines.slice(scope.start, scope.end);
  const first = body.findIndex((l) => /^### /.test(l));
  const preamble = (first < 0 ? body : body.slice(0, first)).join("\n").trim();
  const blocks: string[][] = [];
  if (first >= 0) {
    const rest = body.slice(first);
    let cur: string[] | null = null;
    for (const l of rest) {
      if (/^### /.test(l)) {
        cur = [l];
        blocks.push(cur);
      } else cur?.push(l);
    }
  }
  const trimmed = blocks.map((b) => {
    const c = [...b];
    while (c.length > 0 && (c[c.length - 1] ?? "").trim() === "") c.pop();
    return c;
  });
  const at = trimmed.findIndex((b) => (b[0] ?? "").slice(4).trim().toLowerCase() === idKey);
  if (at >= 0) trimmed[at] = block;
  else trimmed.push(block);
  const out: string[] = [...head, ""];
  if (preamble !== "") out.push(...preamble.split("\n"), "");
  trimmed.forEach((b, i) => {
    if (i > 0) out.push("");
    out.push(...b);
  });
  if (tail.length > 0) out.push("", ...tail);
  else out.push("");
  return out.join("\n");
}

// ----------------------------------------------------------------- check

/** Valid evidence path: posix, relative, no `..`, under `spike/` or `docs/spikes/`. */
export function isValidEvidencePath(p: string): boolean {
  if (p === "" || p.includes("\\") || p.startsWith("/")) return false;
  if (p.split("/").includes("..")) return false;
  return p.startsWith("spike/") || p.startsWith("docs/spikes/");
}

export function checkResults(md: string, o: CheckOptions): Finding[] {
  const doc = parseDoc(md);
  const out: Finding[] = [];
  const add = (line: number, rule: string): void => {
    out.push({ file: RESULTS_FILE, line, rule });
  };
  for (const err of doc.errors) add(err.line, "results/parse");
  const byId = new Map<string, ResultsEntry>();
  for (const { entry: e, line } of doc.entries) {
    byId.set(e.id.toLowerCase(), e);
    if (e.result === "pending") {
      if ((e.reason ?? "").trim() === "") add(line, "results/pending-reason");
    } else {
      const bad = e.evidence.filter((p) => !isValidEvidencePath(p));
      if (bad.length > 0) add(line, "results/evidence-path");
      const good = e.evidence.filter(isValidEvidencePath);
      if (!good.some((p) => o.exists(p))) add(line, "results/evidence-missing");
      if (e.branch.trim() === "") add(line, "results/branch");
      if (e.affects.length === 0) add(line, "results/affects");
    }
    if (e.result === "PARTIAL") {
      if ((e.reason ?? "").trim() === "") add(line, "results/partial-parts");
      if (e.openHumanSteps.length === 0) add(line, "results/partial-steps");
    }
  }
  for (const row of doc.tables) {
    const ri = colIndex(row.header, "result");
    if (ri < 0) continue;
    const token = resultToken(row.cells[ri] ?? "");
    const e = byId.get(row.id.toLowerCase());
    if (e && token !== e.result.toLowerCase()) add(row.line, "results/table-mismatch");
    if (token === "pending") {
      const filled = ["evidence", "branch", "date"].some((k) => {
        const i = colIndex(row.header, k);
        return i >= 0 && (row.cells[i] ?? "") !== "";
      });
      if (filled) add(row.line, "results/pending-row-value");
    }
  }
  if (o.gate) {
    const g = evaluateGate(
      doc.entries.map((x) => x.entry),
      o.exists,
    );
    if (g.missing.length > 0) add(1, "results/gate-missing");
    if (g.pending.length > 0) add(1, "results/gate-pending");
  }
  return out;
}

export function evaluateGate(
  entries: readonly ResultsEntry[],
  exists: (p: string) => boolean,
): { open: boolean; counts: Record<ResultValue, number>; missing: string[]; pending: string[] } {
  const counts: Record<ResultValue, number> = { PASS: 0, FAIL: 0, PARTIAL: 0, pending: 0 };
  const byId = new Map<string, ResultsEntry>();
  for (const e of entries) {
    counts[e.result] += 1;
    if (!byId.has(e.id.toLowerCase())) byId.set(e.id.toLowerCase(), e);
  }
  const missing: string[] = [];
  const pending: string[] = [];
  for (const id of GATE_LIST) {
    const e = byId.get(id);
    if (e === undefined) missing.push(id);
    else if (e.result === "pending") pending.push(id);
    else if (
      e.evidence.length === 0 ||
      !e.evidence.every((p) => isValidEvidencePath(p) && exists(p))
    )
      missing.push(id);
  }
  return { open: missing.length === 0 && pending.length === 0, counts, missing, pending };
}
