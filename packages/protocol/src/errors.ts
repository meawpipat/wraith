/**
 * Error catalogue (R18). Seed with the three codes the entry function needs (task 3.3);
 * task 10.1 replaces the entries with all codes of §6.9 / Appendix A and adds helpers.
 * Texts come from architecture.md §6.9.
 */
import { z } from "zod";

/** Who raises a code (R18.2). `all` stands for "all sides". */
export type Raiser = "relay" | "node" | "pwa" | "sprite" | "watch" | "device" | "app" | "all";

export type ErrorEntry = {
  raisedBy: readonly Raiser[];
  /** HTTP status, or null where §6.9 has no status. */
  http: number | null;
  meaning: string;
  clientAction: string;
};

export const ERROR_CATALOGUE = {
  E_PAYLOAD_TOO_LARGE: {
    raisedBy: ["relay", "node"],
    http: 413,
    meaning: "envelope > 256KB / frame > 64KB / attachment > 8KB",
    clientAction: "Truncate or send via refs",
  },
  E_UNSUPPORTED_VERSION: {
    raisedBy: ["all"],
    http: 400,
    meaning: "`v` ≠ 1",
    clientAction: "Update the client",
  },
  E_SCHEMA_INVALID: {
    raisedBy: ["relay", "node", "sprite"],
    http: 400,
    meaning: "Envelope or body fails the zod schema (other than version/size)",
    clientAction: "Do not retry; log the field path (never the body)",
  },
} as const satisfies Record<`E_${string}`, ErrorEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

export const ERROR_CODES = Object.keys(ERROR_CATALOGUE) as unknown as readonly [
  ErrorCode,
  ...ErrorCode[],
];

/** Accepts only codes in the catalogue (R18.9). */
export const ErrorCodeSchema = z.enum(ERROR_CODES as unknown as [ErrorCode, ...ErrorCode[]]);
