import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import {
  FAIL_BRANCH,
  isInside,
  judgeAcpList,
  judgeCliList,
  judgeQ30,
  type ListResult,
  run,
} from "../../kiro/q30/q30.ts";
import { readSpikeMeta } from "../../lib/meta.ts";
import type { SpikeContext } from "../../lib/outcome.ts";
import { withBinDir } from "../support/bin-dir.ts";
import { fakeKiroSource } from "../support/fake-kiro.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(d);
  return d;
}

interface Setup {
  ctx: SpikeContext;
  root: string;
  logFile: string;
  files: Map<string, string>;
}

function setup(): Setup {
  const root = temp("wraith-q30-");
  const scratch = join(root, "scratch");
  const evDir = join(root, "evidence-out");
  mkdirSync(scratch);
  mkdirSync(evDir);
  const meta = readSpikeMeta("q30");
  if (!meta.ok) throw new Error(meta.reason);
  const files = new Map<string, string>();
  const ctx: SpikeContext = {
    q: "q30",
    meta: meta.meta,
    root,
    session: "wsp",
    scratch,
    hc: null,
    env: () => ({}),
    evidence: {
      dir: evDir,
      stamp: "test",
      async addText(name, text) {
        files.set(name, text);
        writeFileSync(join(evDir, name), text);
      },
      async addJsonl(name, src) {
        const out: string[] = [];
        for await (const l of src) out.push(l);
        const text = out.length === 0 ? "" : `${out.join("\n")}\n`;
        files.set(name, text);
        writeFileSync(join(evDir, name), text);
      },
      async finish() {
        throw new Error("not used");
      },
    },
    approval: async () => ({ outcome: "cancelled", reason: "policy" }),
    shared: null,
    humanStep: () => {},
    now: () => new Date(),
    interactive: true,
    allowHomeProfile: false,
  };
  return { ctx, root, logFile: join(root, "fake.log"), files };
}

type Listing = "listed" | "empty" | "unsupported";

/**
 * A `kiro-cli` wrapper around the shared fake: the first `acp` start is the shared fake agent;
 * a later `acp` start (the listing process) answers `initialize` and `session/list` only;
 * `chat --list-sessions` prints what the test chose. The shared fake is not edited.
 */
function wrapper(acp: Listing, cli: Listing): string {
  return `const fs = require("node:fs");
const path = require("node:path");
const CFG = ${JSON.stringify({ acp, cli })};
const argv = process.argv.slice(2);
const state = path.join(__dirname, "state");
if (argv[0] === "chat" && argv[1] === "--list-sessions") {
  process.stdout.write(CFG.cli === "listed" ? "sess-1\\t" + process.cwd() + "\\n" : "No sessions\\n");
} else if (argv[0] === "acp" && fs.existsSync(state)) {
  let buf = "";
  const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\\n");
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => {
    buf += c;
    let at;
    while ((at = buf.indexOf("\\n")) >= 0) {
      const msg = JSON.parse(buf.slice(0, at));
      buf = buf.slice(at + 1);
      if (msg.method === "initialize") send({ id: msg.id, result: { protocolVersion: 1 } });
      else if (msg.method === "session/list") {
        if (CFG.acp === "unsupported") send({ id: msg.id, error: { code: -32601, message: "no" } });
        else send({ id: msg.id, result: { sessions: CFG.acp === "listed" ? [{ sessionId: "sess-1", cwd: process.cwd() }] : [] } });
      }
    }
  });
  process.stdin.on("end", () => process.exit(0));
} else {
  if (argv[0] === "acp") fs.writeFileSync(state, "1");
  require("./kiro-base.js");
}
`;
}

async function withFake<T>(s: Setup, acp: Listing, cli: Listing, fn: () => Promise<T>): Promise<T> {
  const base = fakeKiroSource({ version: "2.0.1", listSessionsHelp: "", logFile: s.logFile });
  return withBinDir({ "kiro-cli": wrapper(acp, cli), "kiro-base.js": base }, async (env) => {
    s.ctx.env = () => env;
    return fn();
  });
}

function argvRecords(logFile: string): string[][] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as { kind: string; argv?: string[] })
    .filter((r) => r.kind === "argv")
    .map((r) => r.argv ?? []);
}

const LISTED: ListResult = { status: "listed", detail: "" };
const ABSENT: ListResult = { status: "absent", detail: "" };

describe("Q30 script (fake kiro-cli)", () => {
  it("has a valid metadata block", () => {
    const m = readSpikeMeta("q30");
    expect(m.ok && m.meta.runBy).toBe("owner");
    expect(m.ok && m.meta.maxPrompts).toBe(2);
    expect(m.ok && m.meta.maxWallSeconds).toBe(1200);
    expect(m.ok && m.meta.depends).toEqual(["q43"]);
    expect(m.ok && m.meta.human).toEqual(["HS-S2"]);
  });

  it("passes when both listings show the id for the scratch cwd", async () => {
    const s = setup();
    await withFake(s, "listed", "listed", async () => {
      const out = await run(s.ctx);
      expect(out.result).toBe("PASS");
      expect(out.promptsSent).toBe(1);
      expect(out.criteria.map((c) => c.ok)).toEqual([true, true]);
      const session = JSON.parse(s.files.get("session.json") ?? "{}");
      expect(session.sessionId).toBe("sess-1");
      expect(isInside(s.root, session.cwd)).toBe(true);
      expect(session.cwd).toBe(s.ctx.scratch);
      expect(s.files.has("acp-list.json")).toBe(true);
      expect(s.files.get("cli-list.txt")).toContain("sess-1");
      expect(existsSync(join(s.root, "q30.jsonl"))).toBe(true);
      // one agent process for the prompt, one for the listing; no profile selected
      expect(argvRecords(s.logFile)).toEqual([["acp", "--agent-engine", "v3"]]);
    });
  });

  it("passes on the CLI listing alone when session/list is not implemented", async () => {
    const s = setup();
    await withFake(s, "unsupported", "listed", async () => {
      const out = await run(s.ctx);
      expect(out.result).toBe("PASS");
      expect(out.criteria.map((c) => c.ok)).toEqual([false, true]);
      expect(out.criteria[0]?.observed).toContain("unsupported");
    });
  });

  it("passes on the ACP listing alone", async () => {
    const s = setup();
    await withFake(s, "listed", "empty", async () => {
      const out = await run(s.ctx);
      expect(out.result).toBe("PASS");
      expect(out.criteria.map((c) => c.ok)).toEqual([true, false]);
    });
  });

  it("fails with the workspaces-table branch when neither lists the id", async () => {
    const s = setup();
    await withFake(s, "empty", "empty", async () => {
      const out = await run(s.ctx);
      expect(out.result).toBe("FAIL");
      expect(out.branch).toBe(FAIL_BRANCH);
      expect(out.branch).toContain("workspaces");
    });
  });

  it("refuses a scratch folder outside the Spike_Root and starts nothing", async () => {
    const s = setup();
    s.ctx.scratch = temp("wraith-q30-other-");
    await withFake(s, "listed", "listed", async () => {
      const out = await run(s.ctx);
      expect(out.result).toBe("pending");
      expect(argvRecords(s.logFile)).toEqual([]);
    });
  });

  it("is pending when kiro-cli is not found", async () => {
    const s = setup();
    s.ctx.env = () => ({ PATH: "/nonexistent-wraith-dir" });
    const out = await run(s.ctx);
    expect(out.result).toBe("pending");
    expect(out.reason).toContain("kiro-cli");
  });
});

describe("Q30 verdict helpers", () => {
  it("reads a session/list result by id and cwd", () => {
    const cwd = temp("wraith-q30-cwd-");
    const other = temp("wraith-q30-cwd-");
    expect(judgeAcpList({ sessions: [{ sessionId: "a", cwd }] }, "a", cwd).status).toBe("listed");
    expect(judgeAcpList({ sessions: [{ sessionId: "a", cwd: other }] }, "a", cwd).status).toBe(
      "absent",
    );
    expect(judgeAcpList({ sessions: [{ sessionId: "b", cwd }] }, "a", cwd).status).toBe("absent");
    expect(judgeAcpList({ nope: 1 }, "a", cwd).status).toBe("error");
  });

  it("finds the id in the CLI output", () => {
    expect(judgeCliList("x\nsess-1 /tmp\n", "sess-1").status).toBe("listed");
    expect(judgeCliList("No sessions\n", "sess-1").status).toBe("absent");
  });

  it("is a PASS iff at least one way lists the id", () => {
    const statuses: ListResult[] = [
      LISTED,
      ABSENT,
      { status: "unsupported", detail: "" },
      { status: "error", detail: "" },
    ];
    fc.assert(
      fc.property(fc.constantFrom(...statuses), fc.constantFrom(...statuses), (a, b) => {
        const listed = a.status === "listed" || b.status === "listed";
        expect(judgeQ30(a, b)).toBe(listed ? "PASS" : "FAIL");
      }),
    );
  });
});
