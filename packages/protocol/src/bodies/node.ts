/**
 * Node configuration bodies: `node.configure`, `node.configured` (architecture §6.2).
 * Schemas use the zod default (strip), never `.strict()`.
 */
import { z } from "zod";
import {
  APPROVAL_TIMEOUT_MAX_MIN,
  APPROVAL_TIMEOUT_MIN_MIN,
  AUTOPILOT_ASK_ENTRY_MAX_CHARS,
  AUTOPILOT_ASK_MAX_COUNT,
} from "../limits.js";
import { maxCodePoints } from "../text.js";

/** Approval timeout in minutes, from APPROVAL_TIMEOUT_MIN_MIN to APPROVAL_TIMEOUT_MAX_MIN. */
const ApprovalTimeoutMin = z
  .number()
  .int()
  .gte(APPROVAL_TIMEOUT_MIN_MIN)
  .lte(APPROVAL_TIMEOUT_MAX_MIN);

/** Glob entry for `autopilotAsk`, at most AUTOPILOT_ASK_ENTRY_MAX_CHARS code points. */
const AutopilotAskEntry = z.string().superRefine(maxCodePoints(AUTOPILOT_ASK_ENTRY_MAX_CHARS));

/** Default autopilot rules that can be turned off. The hard floor cannot be listed. */
export const AutopilotRule = z.enum([
  "git-push",
  "git-destroy",
  "publish",
  "rm-recursive",
  "pipe-to-shell",
  "network-out",
  "remote-install",
  "system",
]);
export type AutopilotRule = z.infer<typeof AutopilotRule>;

/**
 * `node.configure`.
 *
 * Verifier: the signer must be the owner or a Full device (not `watch`, not viewer). The node
 * applies the value to approval requests created after it; pending ones keep their `expiresAt`.
 */
export const NodeConfigureBody = z.object({
  node: z.string(),
  approvalTimeoutMin: ApprovalTimeoutMin.optional(),
  autopilotAsk: z.array(AutopilotAskEntry).max(AUTOPILOT_ASK_MAX_COUNT).optional(),
  autopilotOff: z.array(AutopilotRule).optional(),
});
export type NodeConfigureBody = z.infer<typeof NodeConfigureBody>;

/** `node.configured`: the current values, sent as the reply and on every node `hello`. */
export const NodeConfiguredBody = z.object({
  node: z.string(),
  approvalTimeoutMin: ApprovalTimeoutMin,
  autopilotAsk: z.array(AutopilotAskEntry).max(AUTOPILOT_ASK_MAX_COUNT),
  autopilotOff: z.array(AutopilotRule),
});
export type NodeConfiguredBody = z.infer<typeof NodeConfiguredBody>;
