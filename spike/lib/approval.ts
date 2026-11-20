export interface PermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export interface PermissionRequest {
  tool: string;
  args: unknown;
  options: PermissionOption[];
}

export type PermissionAnswer =
  | { outcome: "selected"; optionId: string; kind: PermissionOption["kind"]; by: "owner" }
  | {
      outcome: "rejected";
      optionId: string;
      reason: "timeout" | "non-interactive" | "policy" | "no-reject-option";
    }
  | { outcome: "cancelled"; reason: "timeout" | "non-interactive" | "policy" };

export interface ApprovalPolicy {
  kind: "ask-owner" | "reject-all";
  allowAlways: "never" | "manual";
  timeoutMs: 120_000;
}

export interface OwnerIo {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
}

export const APPROVAL_TIMEOUT_MS = 120_000;

function isReject(o: PermissionOption): boolean {
  return o.kind === "reject_once" || o.kind === "reject_always";
}

function rejectAnswer(
  req: PermissionRequest,
  reason: "timeout" | "non-interactive" | "policy",
): PermissionAnswer {
  const opt =
    req.options.find((o) => o.kind === "reject_once") ?? req.options.find((o) => isReject(o));
  if (opt === undefined) return { outcome: "cancelled", reason };
  return { outcome: "rejected", optionId: opt.optionId, reason };
}

/**
 * The whole approval decision. Returns null when the key means "keep waiting".
 * An allow kind is returned only as `selected` with `by:"owner"` for a key that maps to it.
 */
export function pickOption(
  req: PermissionRequest,
  key: string | null,
  p: ApprovalPolicy,
  interactive: boolean,
  timedOut: boolean,
): PermissionAnswer | null {
  if (!interactive) return rejectAnswer(req, "non-interactive");
  if (p.kind === "reject-all") return rejectAnswer(req, "policy");
  if (timedOut) return rejectAnswer(req, "timeout");
  if (key === null || !/^[1-9]$/.test(key)) return null;
  const opt = req.options[Number(key) - 1];
  if (opt === undefined) return null;
  if (opt.kind === "allow_always" && p.allowAlways !== "manual") return null;
  return { outcome: "selected", optionId: opt.optionId, kind: opt.kind, by: "owner" };
}

function describeArgs(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2) ?? String(args);
  } catch {
    return String(args);
  }
}

function render(req: PermissionRequest, p: ApprovalPolicy): string {
  const lines = [`Permission request: ${req.tool}`, `Arguments: ${describeArgs(req.args)}`];
  req.options.forEach((o, i) => {
    const off = o.kind === "allow_always" && p.allowAlways !== "manual";
    lines.push(`  [${i + 1}] ${o.name} (${o.kind})${off ? " - not offered" : ""}`);
  });
  lines.push("Press the option number. No answer within 120 s rejects.");
  return `${lines.join("\n")}\n`;
}

export function askOwner(
  req: PermissionRequest,
  p: ApprovalPolicy,
  io: OwnerIo,
): Promise<PermissionAnswer> {
  const interactive = io.stdin.isTTY === true && io.stdout.isTTY === true;
  const immediate = pickOption(req, null, p, interactive, false);
  if (immediate !== null) return Promise.resolve(immediate);

  io.stdout.write(render(req, p));
  const stdin = io.stdin;
  return new Promise<PermissionAnswer>((resolve) => {
    let done = false;
    const finish = (a: PermissionAnswer): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stdin.removeListener("data", onData);
      try {
        stdin.setRawMode?.(false);
      } catch {
        // ignore
      }
      stdin.pause();
      resolve(a);
    };
    const onData = (chunk: Buffer | string): void => {
      const text = chunk.toString();
      if (text === "\u0003") {
        finish(rejectAnswer(req, "policy"));
        return;
      }
      const a = pickOption(req, text.charAt(0), p, true, false);
      if (a !== null) finish(a);
    };
    const timer = setTimeout(() => {
      const a = pickOption(req, null, p, true, true);
      if (a !== null) finish(a);
    }, p.timeoutMs);
    stdin.setRawMode?.(true);
    stdin.on("data", onData);
    stdin.resume();
  });
}
