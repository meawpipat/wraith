// spike-meta
// id: q13
// group: A
// cost: none
// run-by: loop
// agents:
// max-prompts: 0
// max-wall-seconds: 900
// estimate-credits: none
// claude-prompts: 0
// human:
// depends: q2
// shares: none
// allow-always: never
// assumption:
// end-spike-meta

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HcResult } from "../../lib/hc.ts";
import type {
  CriterionRecord,
  ResultValue,
  SpikeContext,
  SpikeOutcome,
} from "../../lib/outcome.ts";

/** Q13 asks whether herdr-core templates, `first_message` or `terminal.wait` replace sprite work. */
export const NO_REPLACEMENT_BRANCH = "use the sprite as designed";

const HERE = dirname(fileURLToPath(import.meta.url));
const HC_DIR = join(HERE, "..");
const MAX_TEXT = 4000;
const STUB_SOURCE =
  "console.log('q13-stub ready');process.stdin.on('data',d=>console.log('q13-stub got '+d));setTimeout(()=>process.exit(0),3000)";

/** What would count as replacing sprite work (ACP session handling or the prompt queue). */
const SPRITE_WORK =
  /\b(acp|session\/prompt|session\/load|prompt[ _-]?queue|queue(d|ing)?\b|stop[_ ]?reason|end_turn)/i;

export interface Replacements {
  template: boolean;
  firstMessage: boolean;
  wait: boolean;
}

export interface Q13Verdict {
  result: Extract<ResultValue, "PASS" | "FAIL">;
  branch?: string;
}

/** PASS only if one feature replaces part of the sprite's ACP or queue work (R13.10). */
export function judgeQ13(r: Replacements): Q13Verdict {
  if (r.template || r.firstMessage || r.wait) return { result: "PASS" };
  return { result: "FAIL", branch: NO_REPLACEMENT_BRANCH };
}

/** Observed text of each probe. A missing text means the probe produced nothing. */
export interface Observations {
  schemaText: string | null;
  templatesText: string;
  templateRunText: string;
  waitText: string;
}

/** Lexical check: does the observed text claim ACP or queue semantics? Judged by the loop at `record`. */
export function detectReplacements(o: Observations): Replacements {
  const schema = o.schemaText ?? "";
  const fm = lines(schema).filter((l) => /first_message|first-message/i.test(l));
  const waitLines = lines(schema).filter((l) => /terminal\.wait|\bwait\b/i.test(l));
  return {
    template: SPRITE_WORK.test(o.templatesText) || SPRITE_WORK.test(o.templateRunText),
    firstMessage: fm.some((l) => SPRITE_WORK.test(l)),
    wait: waitLines.some((l) => SPRITE_WORK.test(l)) || SPRITE_WORK.test(o.waitText),
  };
}

function lines(text: string): string[] {
  return text.split("\n");
}

/** Reads Q2's schema: the named copy when present, else the newest evidence stamp folder. */
export function readQ2Schema(hcDir: string = HC_DIR): string | null {
  const named = join(hcDir, "schema.json");
  try {
    if (existsSync(named)) return readFileSync(named, "utf8");
    const evidence = join(hcDir, "q2", "evidence");
    const stamps = readdirSync(evidence)
      .filter((n) => /^\d{8}T\d{6}Z/.test(n))
      .sort();
    for (let i = stamps.length - 1; i >= 0; i--) {
      const file = join(evidence, stamps[i] ?? "", "schema.json");
      if (existsSync(file)) return readFileSync(file, "utf8");
    }
  } catch {
    return null;
  }
  return null;
}

interface Step {
  label: string;
  args: string[];
}

interface StepResult {
  label: string;
  ran: boolean;
  code: number | null;
  text: string;
}

function clip(s: string): string {
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n[clipped]` : s;
}

async function step(ctx: SpikeContext, s: Step): Promise<StepResult> {
  if (ctx.hc === null) throw new Error("q13 needs an hc handle");
  try {
    const r: HcResult = await ctx.hc.run(s.args, { timeoutMs: 20_000 });
    return {
      label: s.label,
      ran: true,
      code: r.code,
      text: clip(`$ hc ${s.args.join(" ")}\nexit ${r.code}\n${r.stdout}${r.stderr}`),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "failed";
    return {
      label: s.label,
      ran: false,
      code: null,
      text: `$ hc ${s.args.join(" ")}\nnot run: ${msg}`,
    };
  }
}

/** First template name in `hc templates` output: a JSON array of names or objects, else the first word. */
export function firstTemplateName(text: string): string | null {
  try {
    const j: unknown = JSON.parse(text);
    const list = Array.isArray(j) ? j : (j as { templates?: unknown })?.templates;
    if (Array.isArray(list) && list.length > 0) {
      const f: unknown = list[0];
      if (typeof f === "string") return f;
      const name = (f as { name?: unknown } | null)?.name;
      if (typeof name === "string") return name;
    }
    return null;
  } catch {
    const m = /^\s*([A-Za-z][\w.-]*)/m.exec(text);
    return m?.[1] ?? null;
  }
}

function terminalId(text: string): string | null {
  return /\bt\d+\b/.exec(text)?.[0] ?? null;
}

/** `hcDir` is only for tests; the runner passes the context alone. */
export async function run(ctx: SpikeContext, hcDir: string = HC_DIR): Promise<SpikeOutcome> {
  const notes: string[] = [];
  const criteria: CriterionRecord[] = [];
  const schemaText = readQ2Schema(hcDir);
  notes.push(
    schemaText === null
      ? "q2 schema evidence not found; schema lines were not checked"
      : "q2 schema evidence read",
  );

  const templates = await step(ctx, { label: "templates", args: ["templates"] });
  const name = templates.ran
    ? firstTemplateName(templates.text.split("\n").slice(2).join("\n"))
    : null;

  const stubRun = await step(ctx, {
    label: "stub-run",
    args: ["run", "--bg", "--", "node", "-e", STUB_SOURCE],
  });
  const stubId = terminalId(stubRun.text.split("\n").slice(2).join("\n"));

  const templateRun =
    name === null
      ? ({
          label: "template-run",
          ran: false,
          code: null,
          text: "no template name observed; not run",
        } as StepResult)
      : await step(ctx, { label: "template-run", args: ["run", "--bg", "--template", name] });

  const wait =
    stubId === null
      ? ({
          label: "wait",
          ran: false,
          code: null,
          text: "no terminal id observed; not run",
        } as StepResult)
      : await step(ctx, { label: "wait", args: ["wait", stubId, "--timeout", "5"] });

  const steps = [templates, stubRun, templateRun, wait];
  for (const s of steps) {
    criteria.push({
      id: `q13-${s.label}-observed`,
      ok: s.ran && s.code === 0,
      observed: s.ran ? `exit ${s.code}` : "not run",
    });
  }

  const repl = detectReplacements({
    schemaText,
    templatesText: templates.text,
    templateRunText: templateRun.text,
    waitText: wait.text,
  });
  const verdict = judgeQ13(repl);
  criteria.push({
    id: "q13-replaces-sprite-work",
    ok: verdict.result === "PASS",
    observed: `template=${repl.template} first_message=${repl.firstMessage} wait=${repl.wait}`,
  });

  await ctx.evidence.addText("templates.txt", templates.text);
  await ctx.evidence.addText("stub-run.txt", stubRun.text);
  await ctx.evidence.addText("template-run.txt", templateRun.text);
  await ctx.evidence.addText("wait.txt", wait.text);
  await ctx.evidence.addText(
    "summary.json",
    `${JSON.stringify({ replacements: repl, result: verdict.result, branch: verdict.branch ?? null }, null, 2)}\n`,
  );
  notes.push("observed behaviour only; the loop writes the judgement text at record time");

  const outcome: SpikeOutcome = {
    result: verdict.result,
    criteria,
    affects: [],
    openHumanSteps: [],
    promptsSent: 0,
    notes,
  };
  if (verdict.branch !== undefined) outcome.branch = verdict.branch;
  return outcome;
}
