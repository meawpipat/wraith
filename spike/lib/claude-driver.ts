import { APPROVAL_TIMEOUT_MS, type PermissionAnswer, type PermissionRequest } from "./approval.ts";
import { assertSafeClaudeLaunch, type ClaudeLaunchView } from "./claude-launch.ts";

/**
 * Port to the Claude driver. The real SDK binding is written by task 13.8; until a
 * binding is bound the Claude halves of Q33 and Q35 end `pending` with
 * `CLAUDE_DRIVER_UNAVAILABLE`, never `FAIL`.
 */
export const CLAUDE_DRIVER_UNAVAILABLE = "Claude driver not available";

export type ClaudeDecision = "allow" | "deny";

/** The owner callback: shows the request and returns the owner's answer. */
export type OwnerCallback = (req: PermissionRequest) => Promise<PermissionAnswer>;

/** Called by a driver for every tool request. Resolves `deny` on timeout, error or reject. */
export type ClaudePermissionGate = (req: PermissionRequest) => Promise<ClaudeDecision>;

export interface ClaudeCommand {
  readonly name: string;
  /** Untrusted, display-only; the caller redacts it before storing. */
  readonly description?: string;
}

export interface ClaudeForkOffer {
  readonly offered: boolean;
  readonly detail?: string;
}

export interface ClaudePromptResult {
  readonly text: string;
  readonly sessionId: string;
}

export interface ClaudeSession {
  readonly sessionId: string;
  prompt(text: string): Promise<ClaudePromptResult>;
  supportedCommands(): Promise<readonly ClaudeCommand[]>;
  offerFork(): Promise<ClaudeForkOffer>;
  close(): Promise<void>;
}

export interface ClaudeDriver {
  /** Starts a session. `launch` has already passed `assertSafeClaudeLaunch`. */
  start(launch: ClaudeLaunchView, gate: ClaudePermissionGate): Promise<ClaudeSession>;
}

/**
 * Builds the gate. Only a `selected` answer by the owner with an allow kind gives `allow`.
 * A timeout (own timer, in addition to the owner callback's), an error, a reject, a
 * cancel and any other answer give `deny`.
 */
export function makePermissionGate(
  ask: OwnerCallback,
  timeoutMs: number = APPROVAL_TIMEOUT_MS,
): ClaudePermissionGate {
  return async (req) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    try {
      const answer = await Promise.race([ask(req), timeout]);
      if (answer === "timeout") return "deny";
      if (
        answer.outcome === "selected" &&
        answer.by === "owner" &&
        (answer.kind === "allow_once" || answer.kind === "allow_always")
      ) {
        return "allow";
      }
      return "deny";
    } catch {
      return "deny";
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Starts a session through a driver. The launch view is checked first; an unsafe view
 * throws before the driver is called. Launch options are never built by hand: use
 * `buildClaudeLaunch`.
 */
export async function startClaudeSession(
  driver: ClaudeDriver,
  launch: ClaudeLaunchView,
  ask: OwnerCallback,
  timeoutMs: number = APPROVAL_TIMEOUT_MS,
): Promise<ClaudeSession> {
  assertSafeClaudeLaunch(launch);
  return driver.start(launch, makePermissionGate(ask, timeoutMs));
}
