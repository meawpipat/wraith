import type { PermissionRequest } from "../../lib/approval.ts";
import type {
  ClaudeCommand,
  ClaudeDecision,
  ClaudeDriver,
  ClaudeForkOffer,
  ClaudePermissionGate,
  ClaudeSession,
} from "../../lib/claude-driver.ts";
import type { ClaudeLaunchView } from "../../lib/claude-launch.ts";

export interface FakeClaudeDriverOptions {
  /** Tool requests raised during each `prompt`, in order. */
  readonly toolRequests?: readonly PermissionRequest[];
  readonly commands?: readonly ClaudeCommand[];
  readonly fork?: ClaudeForkOffer;
}

export interface FakeClaudeDriver extends ClaudeDriver {
  /** Launch views received by each `start`, by reference. */
  readonly received: ClaudeLaunchView[];
  /** Gate decisions, in order. */
  readonly decisions: ClaudeDecision[];
  readonly closed: string[];
}

/** Fake driver: records launch options, raises scripted tool requests through the gate. */
export function makeFakeClaudeDriver(opts: FakeClaudeDriverOptions = {}): FakeClaudeDriver {
  const received: ClaudeLaunchView[] = [];
  const decisions: ClaudeDecision[] = [];
  const closed: string[] = [];
  let counter = 0;
  return {
    received,
    decisions,
    closed,
    async start(launch: ClaudeLaunchView, gate: ClaudePermissionGate): Promise<ClaudeSession> {
      received.push(launch);
      counter += 1;
      const sessionId = `fake-claude-${counter}`;
      return {
        sessionId,
        async prompt(text) {
          for (const req of opts.toolRequests ?? []) decisions.push(await gate(req));
          return { text: `echo: ${text}`, sessionId };
        },
        async supportedCommands() {
          return opts.commands ?? [];
        },
        async offerFork() {
          return opts.fork ?? { offered: false };
        },
        async close() {
          closed.push(sessionId);
        },
      };
    },
  };
}
