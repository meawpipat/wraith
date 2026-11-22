// spike-meta
// id: q10
// group: B
// cost: low
// run-by: owner
// agents: kiro
// max-prompts: 6
// max-wall-seconds: 2400
// estimate-credits: 4-10
// claude-prompts: 0
// human: HS-S2, HS-S3
// depends: q3
// shares: none
// allow-always: never
// assumption: A1 Estimate
// end-spike-meta
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { methods } from "@agentclientprotocol/sdk";
import { type AcpEcho, type AcpStartInput, startRawAcp, startSdkAcp } from "../../lib/acp-echo.ts";
import {
  assertSafeProfile,
  buildKiroProfile,
  profilePlacement,
  writeProfileFile,
} from "../../lib/agent-profile.ts";
import type { PermissionAnswer, PermissionRequest } from "../../lib/approval.ts";
import {
  asyncFileLines,
  DEFAULT_REPO_ROOT,
  errorMessage,
  kiroAcpArgv,
  type Q43Placement,
  readQ43Placement,
  recordInMarker,
} from "../../lib/kiro-spike.ts";
import type { CriterionRecord, SpikeContext, SpikeOutcome } from "../../lib/outcome.ts";
import { type ClientRun, compareFrames } from "./compare.ts";

/**
 * Q10 asks whether the ACP SDK (`@agentclientprotocol/sdk`) can drive Kiro as well as the raw
 * JSON-RPC client can. The same scenario runs twice, once per client, against the same agent
 * profile; the owner answers every permission request on both runs. It also checks the ACP field
 * names Q11 relies on (`mcpServers` http entry, `session/list`) against the SDK's own schema.
 */
export const AGENT_NAME = "wraith-spike-q10";
export const PROFILE_PROMPT = "You are a throwaway Wraith spike agent. Do only what the user asks.";
export const PROBE_PROMPT =
  "Use a read-only tool to read the first line of any file in this folder, then tell me what it says.";
export const FAIL_BRANCH =
  "the SDK cannot drive Kiro: build `packages/acp-lite` (about +1 to 2 days)";
export const HOME_PENDING_REASON = "Q43 placed the profile in ~/.kiro/agents/; HS-S6 open";
export const HOME_PENDING_NOTE =
  "Nothing was written to ~/.kiro/agents/. To allow one new file there (HS-S6), re-run: pnpm spike q10 --allow-home-profile";
export const SDK_PACKAGE = "@agentclientprotocol/sdk";
const PERMISSIVE = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"];

export interface Q10Io {
  home?: string;
  command?: string;
  repoRoot?: string;
  placement?: Q43Placement;
  /** Test hook: pretend task 8.1 stopped (SDK not added); the reason ends the run `pending`. */
  sdkMissing?: string;
  /** Test hook: replaces the SDK package folder used for the license and the field names. */
  sdkRoot?: string;
}

export interface SdkFieldNames {
  version: string;
  license: string;
  /** The `type: "http"` MCP server entry in `session/new`. */
  mcpHttp: { required: string[]; properties: string[] } | null;
  header: { required: string[] } | null;
  sessionList: {
    method: string;
    requestFields: string[];
    responseFields: string[];
    capability: boolean;
  };
  /** Q11 uses `{type:"http", name, url, headers:[{name, value}]}`. */
  q11Confirmed: boolean;
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** The folder of the installed SDK package, found from its main entry. */
export function findSdkRoot(): string | null {
  try {
    let dir = dirname(createRequire(import.meta.url).resolve(SDK_PACKAGE));
    for (let i = 0; i < 8; i++) {
      const pkg = join(dir, "package.json");
      if (existsSync(pkg)) {
        const name = (JSON.parse(readFileSync(pkg, "utf8")) as Json).name;
        if (name === SDK_PACKAGE) return dir;
      }
      dir = dirname(dir);
    }
  } catch {
    return null;
  }
  return null;
}

/** Reads the license and the Q11 field names from the SDK's own JSON schema. Read-only. */
export function readSdkFieldNames(sdkRoot: string): SdkFieldNames | { error: string } {
  try {
    const pkg = JSON.parse(readFileSync(join(sdkRoot, "package.json"), "utf8")) as Json;
    const schema = JSON.parse(readFileSync(join(sdkRoot, "schema/v1/schema.json"), "utf8")) as Json;
    const defs = isObject(schema.$defs) ? schema.$defs : {};
    const server = isObject(defs.McpServer) ? defs.McpServer : {};
    const variants = Array.isArray(server.anyOf) ? server.anyOf : [];
    const httpVariant = variants.find(
      (x) =>
        isObject(x) &&
        isObject(x.properties) &&
        isObject(x.properties.type) &&
        x.properties.type.const === "http",
    );
    const httpSchema = isObject(defs.McpServerHttp) ? defs.McpServerHttp : null;
    const mcpHttp =
      isObject(httpSchema) && isObject(httpSchema.properties)
        ? {
            required: strings(httpSchema.required),
            properties: Object.keys(httpSchema.properties),
          }
        : null;
    const headerSchema = isObject(defs.HttpHeader) ? defs.HttpHeader : null;
    const header = headerSchema === null ? null : { required: strings(headerSchema.required) };
    const listReq = isObject(defs.ListSessionsRequest) ? defs.ListSessionsRequest : {};
    const listRes = isObject(defs.ListSessionsResponse) ? defs.ListSessionsResponse : {};
    const caps = isObject(defs.SessionCapabilities) ? defs.SessionCapabilities : {};
    const method = methods.agent.session.list;
    const has = (o: Json, k: string) => isObject(o.properties) && k in o.properties;
    const q11Confirmed =
      httpVariant !== undefined &&
      mcpHttp !== null &&
      ["name", "url", "headers"].every((k) => mcpHttp.properties.includes(k)) &&
      header?.required.includes("name") === true &&
      header.required.includes("value");
    return {
      version: String(pkg.version ?? "unknown"),
      license: String(pkg.license ?? "unknown"),
      mcpHttp,
      header,
      sessionList: {
        method,
        requestFields: isObject(listReq.properties) ? Object.keys(listReq.properties) : [],
        responseFields: isObject(listRes.properties) ? Object.keys(listRes.properties) : [],
        capability: has(caps, "list"),
      },
      q11Confirmed,
    };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

function pending(reason: string, notes: string[], steps: string[]): SpikeOutcome {
  return {
    result: "pending",
    reason,
    criteria: [],
    affects: [],
    openHumanSteps: steps,
    promptsSent: 0,
    notes,
  };
}

interface Seen {
  tool: string;
  optionKinds: string[];
  answered: boolean;
}

interface ClientResult {
  run: ClientRun;
  seen: Seen[];
  stopReason: string | null;
  initialized: boolean;
  sessionId: string | null;
  mcpHttp: boolean | null;
  promptsSent: number;
  partial: string | null;
  notFound: boolean;
}

async function drive(
  ctx: SpikeContext,
  start: (i: AcpStartInput) => AcpEcho,
  input: AcpStartInput,
): Promise<ClientResult> {
  const seen: Seen[] = [];
  const result: ClientResult = {
    run: { frames: [], error: null },
    seen,
    stopReason: null,
    initialized: false,
    sessionId: null,
    mcpHttp: null,
    promptsSent: 0,
    partial: null,
    notFound: false,
  };
  let acp: AcpEcho | null = null;
  try {
    acp = start(input);
    acp.onPermission(async (req: PermissionRequest): Promise<PermissionAnswer> => {
      const entry: Seen = {
        tool: req.tool,
        optionKinds: req.options.map((o) => o.kind),
        answered: false,
      };
      seen.push(entry);
      const answer = await ctx.approval(req);
      entry.answered = true;
      return answer;
    });
    acp.onUpdate(() => {});
    try {
      const init = await acp.initialize({});
      result.initialized = true;
      const caps = isObject(init) && isObject(init.agentCapabilities) ? init.agentCapabilities : {};
      const mcp = isObject(caps.mcpCapabilities) ? caps.mcpCapabilities : null;
      result.mcpHttp = mcp === null ? null : mcp.http === true;
      const created = await acp.newSession(ctx.scratch);
      result.sessionId = created.sessionId;
      result.stopReason = (await acp.prompt(created.sessionId, PROBE_PROMPT)).stopReason;
    } catch (e) {
      const msg = errorMessage(e);
      result.run.error = msg;
      result.notFound = /ENOENT/.test(msg);
    } finally {
      result.promptsSent = acp.promptsSent();
      result.partial = acp.partialReason();
      result.run = { frames: [...acp.frames()], error: result.run.error };
      await acp.close();
    }
  } catch (e) {
    result.run = { frames: acp === null ? [] : [...acp.frames()], error: errorMessage(e) };
  }
  return result;
}

/** Never starts anything but the agent argv from `kiroAcpArgv`; `io` is for tests. */
export async function run(ctx: SpikeContext, io: Q10Io = {}): Promise<SpikeOutcome> {
  const home = io.home ?? homedir();
  const command = io.command ?? "kiro-cli";
  const repoRoot = io.repoRoot ?? DEFAULT_REPO_ROOT;
  const placement = io.placement ?? readQ43Placement(repoRoot);
  const notes: string[] = [];
  if (placement === "unknown")
    notes.push("no Q43 evidence found; the scratch placement is assumed");
  if (placement === "none")
    notes.push("Q43 failed: launched without `--agent`, so the profile is not selected");

  if (io.sdkMissing !== undefined) {
    return pending(`ACP SDK not added (task 8.1): ${io.sdkMissing}`, notes, []);
  }
  const sdkRoot = io.sdkRoot ?? findSdkRoot();
  if (sdkRoot === null) return pending(`${SDK_PACKAGE} is not installed (task 8.1)`, notes, []);
  const fieldNames = readSdkFieldNames(sdkRoot);
  if ("error" in fieldNames) {
    return pending(`could not read the SDK package: ${fieldNames.error}`, notes, []);
  }
  if (!PERMISSIVE.includes(fieldNames.license)) {
    return pending(`${SDK_PACKAGE} license "${fieldNames.license}" is not permissive`, notes, []);
  }

  const profile = buildKiroProfile({ q: "q10", prompt: PROFILE_PROMPT });
  assertSafeProfile(profile);
  const kind = placement === "home" ? "home" : "scratch";
  if (kind === "home" && !ctx.allowHomeProfile) {
    return pending(HOME_PENDING_REASON, [...notes, HOME_PENDING_NOTE], ["HS-S6"]);
  }
  const path = profilePlacement("q10", ctx.scratch, kind, home).path;
  if (kind === "home") {
    ctx.humanStep(
      "HS-S6",
      "Q10 writes one new file, wraith-spike-q10.json, into your ~/.kiro/agents/ and deletes it afterwards. Nothing else there is touched.",
    );
  }

  const rawLog = join(ctx.root, "q10-raw.jsonl");
  const sdkLog = join(ctx.root, "q10-sdk.jsonl");
  const base = {
    argv: kiroAcpArgv(command, "q10", placement),
    cwd: ctx.scratch,
    maxPrompts: ctx.meta.maxPrompts,
    killAfterMs: ctx.meta.maxWallSeconds * 1000,
    root: ctx.root,
  };
  let raw: ClientResult | null = null;
  let sdk: ClientResult | null = null;
  let setupError: string | null = null;
  try {
    recordInMarker(ctx, (m) => writeProfileFile("q10", profile, path, m));
    raw = await drive(ctx, startRawAcp, { ...base, env: ctx.env("agent"), rawLog });
    if (!raw.notFound) {
      sdk = await drive(ctx, startSdkAcp, { ...base, env: ctx.env("agent"), rawLog: sdkLog });
    }
  } catch (e) {
    setupError = errorMessage(e);
  } finally {
    if (kind === "home") rmSync(path, { force: true });
  }

  if (raw?.notFound === true) {
    return pending("kiro-cli was not found on PATH; Q10 needs it installed", notes, []);
  }
  if (raw === null || sdk === null) {
    notes.push(`run error: ${setupError ?? "the SDK run did not start"}`);
    return {
      result: "FAIL",
      criteria: [],
      affects: [],
      openHumanSteps: [],
      promptsSent: raw?.promptsSent ?? 0,
      notes,
      branch: FAIL_BRANCH,
    };
  }

  const comparison = compareFrames(raw.run, sdk.run);
  const rawOk = raw.run.error === null && raw.stopReason !== null;
  const sdkOk = sdk.run.error === null && sdk.stopReason !== null;
  const permissionsMatch =
    raw.seen.length === sdk.seen.length && [...raw.seen, ...sdk.seen].every((s) => s.answered);

  const criteria: CriterionRecord[] = [
    {
      id: "q10-raw-scenario",
      ok: rawOk,
      observed: `raw client: ${raw.run.error ?? `stopReason ${raw.stopReason ?? "none"}`}`,
    },
    {
      id: "q10-sdk-scenario",
      ok: sdkOk,
      observed: `SDK client: ${sdk.run.error ?? `stopReason ${sdk.stopReason ?? "none"}`}`,
    },
    {
      id: "q10-frames-match",
      ok: comparison.equal,
      observed:
        comparison.firstDivergence === null
          ? `${comparison.rawMethods.length} methods, same sequence`
          : `first difference at ${comparison.firstDivergence}: raw ${comparison.rawMethods[comparison.firstDivergence] ?? "end"}, sdk ${comparison.sdkMethods[comparison.firstDivergence] ?? "end"}`,
    },
    {
      id: "q10-permission",
      ok: permissionsMatch,
      observed: `permission requests: raw ${raw.seen.length}, sdk ${sdk.seen.length}; all answered by the owner: ${[...raw.seen, ...sdk.seen].every((s) => s.answered)}`,
    },
    {
      id: "q10-q11-field-names",
      ok: fieldNames.q11Confirmed && fieldNames.sessionList.method === "session/list",
      observed: `SDK ${fieldNames.version}: mcpServers http entry [${fieldNames.mcpHttp?.properties.join(", ") ?? "missing"}], header required [${fieldNames.header?.required.join(", ") ?? "missing"}], list method ${fieldNames.sessionList.method}`,
    },
  ];
  if (sdk.run.error !== null) notes.push(`SDK error: ${sdk.run.error}`);
  if (raw.run.error !== null) notes.push(`raw error: ${raw.run.error}`);
  if (raw.mcpHttp !== null || sdk.mcpHttp !== null) {
    notes.push(`agent mcpCapabilities.http: raw ${raw.mcpHttp}, sdk ${sdk.mcpHttp}`);
  }

  const outcome: SpikeOutcome = {
    result: "FAIL",
    criteria,
    affects: [],
    openHumanSteps: [],
    promptsSent: raw.promptsSent + sdk.promptsSent,
    notes,
  };
  const partial = raw.partial ?? sdk.partial;
  if (partial !== null) {
    outcome.result = "PARTIAL";
    outcome.reason = partial;
  } else if (!rawOk) {
    // The baseline itself did not work, so the SDK cannot be judged.
    outcome.result = "PARTIAL";
    outcome.reason = "the raw client did not finish the scenario, so the SDK cannot be compared";
  } else if (sdkOk && comparison.equal && permissionsMatch) {
    if (criteria[4]?.ok) {
      outcome.result = "PASS";
    } else {
      outcome.result = "PARTIAL";
      outcome.reason = "the SDK works, but the Q11 field names do not match the SDK schema";
    }
  } else {
    outcome.branch = FAIL_BRANCH;
  }

  await ctx.evidence.addJsonl("frames-raw.jsonl", asyncFileLines([rawLog]));
  await ctx.evidence.addJsonl("frames-sdk.jsonl", asyncFileLines([sdkLog]));
  await ctx.evidence.addText("comparison.json", `${JSON.stringify(comparison, null, 2)}\n`);
  await ctx.evidence.addText("field-names.json", `${JSON.stringify(fieldNames, null, 2)}\n`);
  return outcome;
}
