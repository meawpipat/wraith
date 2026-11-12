/**
 * Deterministic valid-message builders for the registry subset (R24.1, R24.11).
 *
 * Fixed ULIDs from a counter, fixed timestamps, placeholder strings. No randomness, no
 * fast-check import, no real keys, hashes or secrets. Every builder returns a complete valid
 * envelope with the `meta.persist`, `meta.to` and `sig` the registry requires for its type.
 *
 * `testing/` imports `src/`; `src/` never imports `testing/`. Tasks 11.1 and 11.4 extend this
 * file to every message type: `BUILDERS` is typed `Record<MessageType, ...>`, so adding a
 * registry entry forces adding a builder.
 */
import type { Envelope, Meta, Sig } from "../envelope.js";
import { type MessageType, persistOf, signerOf } from "../message-types.js";

/** Fixed envelope timestamp (ms since epoch). */
export const FIXTURE_TS = 1_700_000_000_000;

/** Crockford base32 alphabet used by ULIDs (no I, L, O, U). */
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_PREFIX = "0000000000000000000000";
const ULID_COUNTER_DIGITS = 4;
const BASE32 = 32;

let counter = 0;

/** Reset the ULID counter so a test run starts from the same sequence. */
export function resetBuilderCounter(): void {
  counter = 0;
}

/** Format `n` as a valid 26-character ULID (22 zeros plus 4 base32 digits). */
export function fixtureUlid(n: number): string {
  let rest = n;
  let digits = "";
  for (let i = 0; i < ULID_COUNTER_DIGITS; i++) {
    digits = ULID_ALPHABET.charAt(rest % BASE32) + digits;
    rest = Math.floor(rest / BASE32);
  }
  return ULID_PREFIX + digits;
}

/** Next fixed ULID from the counter. */
export function nextUlid(): string {
  counter += 1;
  return fixtureUlid(counter);
}

/** Placeholder signature: patterned, not a real signature. */
function placeholderSig(by: string): Sig {
  return { by, alg: "ES256", value: "A".repeat(86) };
}

type Parts<T extends MessageType> = {
  readonly type: T;
  readonly to: string;
  readonly body: Envelope<T>["body"];
  /** Placeholder signer member id when the message is signed. */
  readonly signedBy: string;
};

/** Assemble a complete envelope; persist and sig follow the registry for this body. */
function assemble<T extends MessageType>(parts: Parts<T>): Envelope<T> {
  const persist = persistOf(parts.type, parts.body) === true;
  const signed = signerOf(parts.type, parts.body);
  const meta = {
    id: nextUlid(),
    ts: FIXTURE_TS,
    space: "space-example",
    type: parts.type,
    to: parts.to,
    persist,
  } as Meta;
  const envelope = {
    v: 1,
    meta,
    body: parts.body,
    ...(signed === "device" || signed === "node" ? { sig: placeholderSig(parts.signedBy) } : {}),
  };
  return envelope as unknown as Envelope<T>;
}

export function buildPing(): Envelope<"ping"> {
  return assemble({ type: "ping", to: "relay", body: { t: FIXTURE_TS }, signedBy: "" });
}

export function buildPong(): Envelope<"pong"> {
  return assemble({ type: "pong", to: "relay", body: { t: FIXTURE_TS }, signedBy: "" });
}

export function buildAck(): Envelope<"ack"> {
  return assemble({
    type: "ack",
    to: "relay",
    body: { id: fixtureUlid(1), seq: 1 },
    signedBy: "",
  });
}

export function buildUserMessage(): Envelope<"user.message"> {
  return assemble({
    type: "user.message",
    to: "bot:example-bot",
    body: { text: "Hello from a placeholder user.", by: "phone" },
    signedBy: "device:example-phone",
  });
}

export function buildBotPost(): Envelope<"bot.post"> {
  return assemble({
    type: "bot.post",
    to: "devices",
    body: { text: "Placeholder bot summary." },
    signedBy: "node:example-node",
  });
}

/** `bot.tool` with a final status (`completed`): node-signed and stored. */
export function buildBotToolFinal(): Envelope<"bot.tool"> {
  return assemble({
    type: "bot.tool",
    to: "devices",
    body: {
      toolCallId: "tool-call-example",
      title: "Read a file",
      kind: "read",
      status: "completed",
      output: "placeholder output",
    },
    signedBy: "node:example-node",
  });
}

/** `bot.tool` with an interim status (`in_progress`): unsigned and not stored. */
export function buildBotToolInterim(): Envelope<"bot.tool"> {
  return assemble({
    type: "bot.tool",
    to: "devices",
    body: {
      toolCallId: "tool-call-example",
      title: "Read a file",
      kind: "read",
      status: "in_progress",
    },
    signedBy: "",
  });
}

export function buildNodeConfigure(): Envelope<"node.configure"> {
  return assemble({
    type: "node.configure",
    to: "node:example-node",
    body: { node: "example-node", approvalTimeoutMin: 30, autopilotAsk: [], autopilotOff: [] },
    signedBy: "device:example-phone",
  });
}

export function buildNodeConfigured(): Envelope<"node.configured"> {
  return assemble({
    type: "node.configured",
    to: "devices",
    body: { node: "example-node", approvalTimeoutMin: 30, autopilotAsk: [], autopilotOff: [] },
    signedBy: "node:example-node",
  });
}

/** One builder per message type (the final-status variant for `bot.tool`). */
export const BUILDERS: { readonly [T in MessageType]: () => Envelope<T> } = {
  ping: buildPing,
  pong: buildPong,
  ack: buildAck,
  "user.message": buildUserMessage,
  "bot.post": buildBotPost,
  "bot.tool": buildBotToolFinal,
  "node.configure": buildNodeConfigure,
  "node.configured": buildNodeConfigured,
};

/** Build a valid envelope of `type`. */
export function buildEnvelope<T extends MessageType>(type: T): Envelope<T> {
  return BUILDERS[type]();
}
