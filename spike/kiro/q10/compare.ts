import type { AcpFrame } from "../../lib/acp-echo.ts";

/** What one client (raw or SDK) saw in the Q10 scenario. `error` is a thrown SDK/schema rejection. */
export interface ClientRun {
  frames: readonly AcpFrame[];
  error: string | null;
}

export interface FrameComparison {
  equal: boolean;
  rawMethods: string[];
  sdkMethods: string[];
  /** Index of the first differing entry, or null when the sequences are equal. */
  firstDivergence: number | null;
  /** The SDK client threw (for example a schema rejection). */
  sdkError: string | null;
  /** The raw client threw; the comparison is then not meaningful. */
  rawError: string | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The ordered `dir:method` entries of a frame log (`session/update` also carries its
 * `sessionUpdate` kind). Responses are left out. Consecutive duplicates collapse, because the
 * number of streamed chunks depends on the model, not on the client.
 */
export function methodSequence(frames: readonly AcpFrame[]): string[] {
  const out: string[] = [];
  for (const f of frames) {
    if (!isObject(f.msg) || typeof f.msg.method !== "string") continue;
    let entry = `${f.dir}:${f.msg.method}`;
    if (f.msg.method === "session/update" && isObject(f.msg.params)) {
      const u = f.msg.params.update;
      if (isObject(u) && typeof u.sessionUpdate === "string") entry += `:${u.sessionUpdate}`;
    }
    if (out[out.length - 1] !== entry) out.push(entry);
  }
  return out;
}

/**
 * The per-direction sequences, client-to-agent first. How a client request and an agent
 * notification interleave on the wire is timing (for example `available_commands_update`
 * racing the first `session/prompt`), not client behaviour, so each direction is ordered alone.
 */
function directionalSequence(frames: readonly AcpFrame[]): string[] {
  return [
    ...methodSequence(frames.filter((f) => f.dir === "c2a")),
    ...methodSequence(frames.filter((f) => f.dir === "a2c")),
  ];
}

/** Pure: same method sequence on both clients and no error thrown by the SDK client. */
export function compareFrames(raw: ClientRun, sdk: ClientRun): FrameComparison {
  const rawMethods = directionalSequence(raw.frames);
  const sdkMethods = directionalSequence(sdk.frames);
  let firstDivergence: number | null = null;
  const n = Math.max(rawMethods.length, sdkMethods.length);
  for (let i = 0; i < n; i++) {
    if (rawMethods[i] !== sdkMethods[i]) {
      firstDivergence = i;
      break;
    }
  }
  return {
    equal: firstDivergence === null && sdk.error === null && raw.error === null,
    rawMethods,
    sdkMethods,
    firstDivergence,
    sdkError: sdk.error,
    rawError: raw.error,
  };
}
