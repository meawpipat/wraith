/**
 * fast-check arbitraries for the registry subset (R24.1, R24.11).
 *
 * This is the only file in the package that imports fast-check (an optional peer dependency),
 * exported through the `./testing/arbitraries` subpath. Generated strings mix ASCII,
 * multi-byte and astral characters so the code point and UTF-8 counting rules are exercised.
 *
 * Property 2 support: `validEnvelopeArb(type)` emits an EXPLICIT value for every defaulted
 * field (`meta.prompt.requires`, `meta.prompt.handoffMode`). `validRawEnvelopeArb(type)` is
 * the variant that may omit them.
 */
import fc from "fast-check";
import type { Envelope } from "../envelope.js";
import {
  APPROVAL_TIMEOUT_MAX_MIN,
  APPROVAL_TIMEOUT_MIN_MIN,
  AUTOPILOT_ASK_MAX_COUNT,
  MEDIA_PER_MESSAGE_MAX_COUNT,
  MENTIONS_PER_MESSAGE_MAX_COUNT,
  REQUIRES_MAX_COUNT,
} from "../limits.js";
import { type MessageType, persistOf, signerOf } from "../message-types.js";

// Local sizes for generated values; well under every protocol limit.
const SHORT_TEXT_LENGTH = 24;
const LIST_LENGTH = 3;
const ULID_LENGTH = 26;
const SHA256_HEX_LENGTH = 64;
const BASE_TS_MIN = 1;
const BASE_TS_MAX = 4_000_000_000_000;
const SMALL_INT_MAX = 1_000_000;
const DIMENSION_MAX = 4096;

const ULID_CHARS = [..."0123456789ABCDEFGHJKMNPQRSTVWXYZ"];
const HEX_CHARS = [..."0123456789abcdef"];
const NAME_CHARS = [..."abcdefghijklmnopqrstuvwxyz0123456789"];

/** One text unit: ASCII, multi-byte (2 and 3 bytes) or astral (4 bytes, surrogate pair). */
const textUnit = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(..."abcXYZ019 .,-_") },
  { weight: 2, arbitrary: fc.constantFrom("é", "ñ", "ü", "日", "本", "語", "€", "я") },
  { weight: 2, arbitrary: fc.constantFrom("😀", "𝒳", "𐍈", "🚀", "𠜎") },
);

/** Text with astral and multi-byte characters, at most `maxLength` units. */
export const textArb = (maxLength: number = SHORT_TEXT_LENGTH): fc.Arbitrary<string> =>
  fc.string({ unit: textUnit, maxLength });

/** Non-empty text for identifiers that must not be empty. */
const nonEmptyTextArb = fc.string({ unit: textUnit, minLength: 1, maxLength: SHORT_TEXT_LENGTH });

export const ulidArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...ULID_CHARS), { minLength: ULID_LENGTH, maxLength: ULID_LENGTH })
  .map((chars) => chars.join(""));

const nameArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...NAME_CHARS), { minLength: 1, maxLength: LIST_LENGTH * 4 })
  .map((chars) => chars.join(""));

const sha256Arb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...HEX_CHARS), {
    minLength: SHA256_HEX_LENGTH,
    maxLength: SHA256_HEX_LENGTH,
  })
  .map((chars) => chars.join(""));

const natArb = fc.integer({ min: 0, max: SMALL_INT_MAX });

/** Drop keys whose value is `undefined` so JSON round trips keep deep equality. */
function defined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as T;
}

const maybe = <T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> =>
  fc.option(arb, { nil: undefined });

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const attachmentArb = fc.record({
  name: textArb(),
  mime: fc.constantFrom("text/plain", "text/markdown"),
  text: textArb(),
  truncated: fc.boolean(),
});

const mediaRefArb = fc
  .record({
    mediaId: ulidArb,
    node: nameArb,
    name: fc.constantFrom("photo.png", "note 1.txt", "clip.mp4"),
    mime: fc.constantFrom("image/png", "text/plain", "video/mp4"),
    bytes: natArb,
    sha256: sha256Arb,
    w: maybe(fc.integer({ min: 1, max: DIMENSION_MAX })),
    h: maybe(fc.integer({ min: 1, max: DIMENSION_MAX })),
    durationMs: maybe(natArb),
    thumb: fc.constantFrom(null, "", "AAAA"),
    origin: fc.constantFrom("bot" as const, "device" as const),
  })
  .map(defined);

const toolKindArb = fc.constantFrom(
  "read" as const,
  "edit" as const,
  "delete" as const,
  "move" as const,
  "search" as const,
  "execute" as const,
  "think" as const,
  "fetch" as const,
  "other" as const,
);

const diffArb = fc
  .record({
    path: textArb(),
    oldText: fc.option(textArb(), { nil: null }),
    newText: textArb(),
  })
  .map(defined);

const locationArb = fc
  .record({ path: textArb(), line: fc.option(natArb, { nil: null }) })
  .map(defined);

const listOf = <T>(arb: fc.Arbitrary<T>, maxLength: number = LIST_LENGTH): fc.Arbitrary<T[]> =>
  fc.array(arb, { maxLength });

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

export const pingBodyArb = fc.record({ t: natArb });
export const pongBodyArb = fc.record({ t: natArb });

export const ackBodyArb = fc.record({ id: ulidArb, seq: maybe(natArb) }).map(defined);

export const userMessageBodyArb = fc
  .record({
    text: textArb(),
    by: fc.constantFrom(
      "phone" as const,
      "desktop" as const,
      "watch" as const,
      "pane-unverified" as const,
    ),
    attachments: maybe(listOf(attachmentArb)),
    media: maybe(listOf(mediaRefArb, MEDIA_PER_MESSAGE_MAX_COUNT)),
    via: maybe(fc.constant("voice" as const)),
  })
  .map(defined);

export const botPostBodyArb = fc.record({ text: textArb() });

const TOOL_STATUSES = ["pending", "in_progress", "completed", "failed"] as const;
type ToolStatusValue = (typeof TOOL_STATUSES)[number];

/** `bot.tool` body; pass a status to pin it (final or interim). */
export const botToolBodyArb = (status?: ToolStatusValue) =>
  fc
    .record({
      toolCallId: nonEmptyTextArb,
      title: textArb(),
      kind: toolKindArb,
      status: status === undefined ? fc.constantFrom(...TOOL_STATUSES) : fc.constant(status),
      diffs: maybe(listOf(diffArb)),
      locations: maybe(listOf(locationArb)),
      output: maybe(textArb()),
    })
    .map(defined);

const autopilotRuleArb = fc.constantFrom(
  "git-push" as const,
  "git-destroy" as const,
  "publish" as const,
  "rm-recursive" as const,
  "pipe-to-shell" as const,
  "network-out" as const,
  "remote-install" as const,
  "system" as const,
);

const approvalTimeoutArb = fc.integer({
  min: APPROVAL_TIMEOUT_MIN_MIN,
  max: APPROVAL_TIMEOUT_MAX_MIN,
});
const autopilotAskArb = listOf(textArb(), Math.min(LIST_LENGTH, AUTOPILOT_ASK_MAX_COUNT));
const autopilotOffArb = fc.uniqueArray(autopilotRuleArb, { maxLength: LIST_LENGTH });

export const nodeConfigureBodyArb = fc
  .record({
    node: nameArb,
    approvalTimeoutMin: maybe(approvalTimeoutArb),
    autopilotAsk: maybe(autopilotAskArb),
    autopilotOff: maybe(autopilotOffArb),
  })
  .map(defined);

export const nodeConfiguredBodyArb = fc.record({
  node: nameArb,
  approvalTimeoutMin: approvalTimeoutArb,
  autopilotAsk: autopilotAskArb,
  autopilotOff: autopilotOffArb,
});

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

const capTagArb = fc.constantFrom(
  "gpu" as const,
  "local-files" as const,
  "cloud" as const,
  "autonomous" as const,
  "git-only" as const,
  "can-approve" as const,
  "private" as const,
  "untrusted" as const,
  "no-handoff" as const,
);

/** Prompt metadata with an explicit value for every defaulted field. */
const promptMetaArb = fc.record({
  promptId: ulidArb,
  replyTo: fc.option(ulidArb, { nil: null }),
  kind: fc.constantFrom("task" as const, "return" as const, "summary" as const),
  to: ulidArb,
  requires: fc.uniqueArray(capTagArb, { maxLength: Math.min(LIST_LENGTH, REQUIRES_MAX_COUNT) }),
  handoffMode: fc.constantFrom("assign" as const, "transfer" as const),
});

/** Optional `meta` members shared by every type (explicit values; undefined = absent). */
const metaExtrasArb = fc
  .record({
    room: maybe(nameArb),
    bot: maybe(ulidArb),
    node: maybe(nameArb),
    epoch: maybe(natArb),
    prompt: maybe(promptMetaArb),
    mentions: maybe(
      fc.array(ulidArb, { maxLength: Math.min(LIST_LENGTH, MENTIONS_PER_MESSAGE_MAX_COUNT) }),
    ),
    leaseEpoch: maybe(natArb),
  })
  .map(defined);

const relayArb = fc.option(
  fc.record({ seq: maybe(natArb), recvTs: natArb, root: maybe(ulidArb) }).map(defined),
  { nil: undefined },
);

const sigArb = fc.record({
  by: nonEmptyTextArb,
  alg: fc.constant("ES256" as const),
  value: fc.constantFrom("A".repeat(86), "B".repeat(86)),
});

/** Routing targets valid for each subset type (the `to` rule of the registry). */
const TO_BY_TYPE: Record<MessageType, fc.Arbitrary<string>> = {
  ping: fc.constant("relay"),
  pong: fc.constant("relay"),
  ack: fc.constant("relay"),
  "user.message": nameArb.map((name) => `bot:${name}`),
  "bot.post": fc.constant("devices"),
  "bot.tool": fc.constant("devices"),
  "node.configure": nameArb.map((name) => `node:${name}`),
  "node.configured": fc.constant("devices"),
};

/** One body arbitrary per message type; the table keys equal the registry keys. */
export const BODY_ARBITRARIES: { readonly [T in MessageType]: fc.Arbitrary<Envelope<T>["body"]> } =
  {
    ping: pingBodyArb,
    pong: pongBodyArb,
    ack: ackBodyArb,
    "user.message": userMessageBodyArb,
    "bot.post": botPostBodyArb,
    "bot.tool": botToolBodyArb(),
    "node.configure": nodeConfigureBodyArb,
    "node.configured": nodeConfiguredBodyArb,
  } as never;

/**
 * Valid envelope of `type` with an explicit value for every defaulted field, so a JSON round
 * trip returns a deeply equal value (Property 2, clause 1). `meta.persist` and `sig` follow
 * the registry for the generated body.
 */
export function validEnvelopeArb<T extends MessageType>(type: T): fc.Arbitrary<Envelope<T>> {
  const body = BODY_ARBITRARIES[type] as fc.Arbitrary<Envelope<T>["body"]>;
  return fc
    .record({
      id: ulidArb,
      ts: fc.integer({ min: BASE_TS_MIN, max: BASE_TS_MAX }),
      space: textArb(),
      to: TO_BY_TYPE[type],
      extras: metaExtrasArb,
      body,
      sig: sigArb,
      relay: relayArb,
    })
    .map(({ id, ts, space, to, extras, body: value, sig, relay }) => {
      const signer = signerOf(type, value);
      const meta = { id, ts, space, type, to, persist: persistOf(type, value) === true, ...extras };
      return defined({
        v: 1,
        meta,
        body: value,
        sig: signer === "device" || signer === "node" ? sig : undefined,
        relay,
      }) as unknown as Envelope<T>;
    });
}

/** Remove the defaulted `meta.prompt` members (`requires`, `handoffMode`) from a value. */
function omitDefaults(envelope: Record<string, unknown>, dropRequires: boolean, dropMode: boolean) {
  const meta = envelope.meta as Record<string, unknown>;
  const prompt = meta.prompt as Record<string, unknown> | undefined;
  if (prompt === undefined) return envelope;
  const { requires, handoffMode, ...rest } = prompt;
  const kept = {
    ...rest,
    ...(dropRequires ? {} : { requires }),
    ...(dropMode ? {} : { handoffMode }),
  };
  return { ...envelope, meta: { ...meta, prompt: kept } };
}

/**
 * Raw envelope value that may omit defaulted fields (Property 2, clause 2). Valid
 * otherwise; the parsed form can differ from this value.
 */
export function validRawEnvelopeArb(type: MessageType): fc.Arbitrary<Record<string, unknown>> {
  return fc
    .tuple(validEnvelopeArb(type), fc.boolean(), fc.boolean())
    .map(([envelope, dropRequires, dropMode]) =>
      omitDefaults(envelope as unknown as Record<string, unknown>, dropRequires, dropMode),
    );
}

/** One valid-envelope arbitrary per message type. */
export const ENVELOPE_ARBITRARIES: {
  readonly [T in MessageType]: fc.Arbitrary<Envelope<T>>;
} = Object.fromEntries(
  (Object.keys(BODY_ARBITRARIES) as MessageType[]).map((type) => [type, validEnvelopeArb(type)]),
) as never;
