# Requirements Document

## Introduction

S-protocol is the first spec of Project Wraith (architecture.md §20 row 1, phases P0 to P1, depends on nothing). It delivers `packages/protocol`: the single place where every wire shape of Wraith is declared as a zod schema. JSON Schema and TypeScript types are generated from those schemas, together with fixtures. The package also owns the numeric limits (`limits.ts`), the error code catalogue, and protocol-owned data (templates, the unsafe-token list, the agent catalogue).

Source of truth: `docs/architecture.md` §6.1 (Envelope), §6.2 (Message catalogue and supporting shapes), §6.5 (sprite messages, as declared in the protocol package), §6.6 (Handoff Packet), §6.9 (Error codes), §12.1 (SI-2, SI-4, SI-6, SI-9 where the data lives in the protocol package), §18.1/§18.2 (DoD items touching the protocol package) and §21.1 (PBT #6 and #14). Each requirement carries a traceability note ("Implements ...") so design and tasks can map back.

Boundary (out of scope, owned by other specs):
- Signing, verification, JCS, SHA-256, HMAC and `requestHash` computation belong to S-crypto. This spec states only the data contract (which fields are in the signature scope).
- Relay routing, sequencing, loop-guard, lease logic, presence, quota handling belong to S-relay-core and related specs.
- Verifier logic (roster lookup, cap checks, replay store, `ts` age, `optionId` membership, `requestHash` match, roster `quickMessages` membership) belongs to S-node-core and S-approval. The protocol package may export constants those checks use, but does not run them.
- Redaction (SI-8), SI-2 validators, context-builder allowlists (SI-6), and the sprite/node runtime are other specs. The protocol package only declares the data they import.
- The `/api/v1` HTTP API (§6.7), the Node-to-Relay handshake (§6.3), MCP tools (§6.4) and relay-core adapter interfaces (§6.8) are not part of this spec, except for the `error` body shape and error codes they reuse.

## Glossary

- **Protocol_Package**: The workspace package `packages/protocol` (zod schemas, generated artifacts, limits, templates, catalogues).
- **Schema_Source**: The hand-written zod schemas in `packages/protocol/src`. They are the only source of truth for wire shapes.
- **Codegen**: The build step that generates JSON Schema files and TypeScript types from the Schema_Source, and records fixtures.
- **Protocol_Codegen_Hook**: The Kiro hook named `protocol-codegen` in `.kiro/hooks` that runs Codegen when Schema_Source changes.
- **Envelope**: The top-level message object `{v, meta, body, sig?, relay?}` (§6.1).
- **Meta**: The routing and identity part of an Envelope. It is `.strict()`.
- **Body**: The content part of an Envelope. Its shape depends on `meta.type`.
- **Sig**: The signature object `{by, alg, value}`.
- **Relay_Fields**: The `relay` object that the relay adds after receipt (`seq`, `recvTs`, `root`, `forwardDepth`, `budgetLeft`, `from`).
- **Signature_Scope**: The object `{v, meta, body}` over which `sig.value` is computed. It excludes `sig` and `relay`.
- **MessageType**: The string enum of every `meta.type` value in the §6.2 message table.
- **BODY_Map**: The exported record `BODY: Record<MessageType, ZodTypeAny>` mapping each MessageType to its body schema.
- **SIGNER_Map**: The exported record `SIGNER: Record<MessageType, "device"|"owner"|"node"|"none"|"challenge">` holding the "Signed by" column of §6.2.
- **Message_Table**: The §6.2 table of message types with direction, persist flag, signer, body and extra checks.
- **Direction**: The routing direction of a message type: D (device or watch), R (relay), N (node), G (sprite). Example: `N→R→D`.
- **Persist_Flag**: The per-type value of `meta.persist` (persisted with a `seq`, or not persisted).
- **Limits_Module**: `packages/protocol/src/limits.ts`, the single module holding every numeric limit.
- **Error_Catalogue**: The typed constant listing every `E_*` code with raised-by, HTTP status, meaning and client action (§6.9).
- **ErrorCode**: The string union of all codes in the Error_Catalogue.
- **Sprite_Schemas**: The schemas in `packages/protocol/src/sprite.ts` for the NDJSON protocol between sprite and node (§6.5).
- **Handoff_Packet**: The body of `room.handoff` and `room.return` (§6.6).
- **Unsafe_Tokens**: The forbidden-argument and forbidden-setting literals in `packages/protocol/src/unsafe.ts` (SI-1, SI-2).
- **Node_Configuration**: Settings stored by the node (`node.json`), not by the Protocol_Package.
- **Terminal_Guard_Template**: `packages/protocol/templates/claude-terminal-guard.json`.
- **Cloud_Prompt_Template**: `packages/protocol/templates/cloud-prompt.txt` (§7.4.1).
- **Agent_Catalogue**: `packages/protocol/src/agents.ts`, the protocol-side catalogue of per-agent terminal data (`exit`, `neverSend`, `terminalCommands`).
- **Runtime_Specific_Module**: Any import of `node:*`, `cloudflare:*`, `bun:*`, or a browser DOM global (`window`, `document`, `localStorage`).
- **Fixture**: A recorded sample message stored under `fixtures/` and validated by tests.
- **Consumer_App**: Any package under `apps/` or any other package that imports from the Protocol_Package.
- **Verifier**: The node or relay code that checks signatures and caps (not part of this spec).

## Requirements

### Requirement 1: One schema per message type and a signer map

**User Story:** As a developer of the relay, node and PWA, I want one body schema and one signer entry for every message type, so that every component validates the same shapes.

Implements §20 row 1 R1, §6.2 (BODY, SIGNER).

#### Acceptance Criteria

1. THE Protocol_Package SHALL export a MessageType enum containing exactly the `meta.type` values listed in the Message_Table of §6.2.
2. THE Protocol_Package SHALL export a BODY_Map with exactly one body schema for each MessageType value.
3. THE Protocol_Package SHALL export a SIGNER_Map with exactly one entry for each MessageType value, using only the values `device`, `owner`, `node`, `none` and `challenge`.
4. THE Protocol_Package SHALL export a per-type metadata record holding, for each MessageType value, the Direction and the Persist_Flag from the Message_Table.
5. THE Protocol_Package SHALL export a typed envelope schema `EnvelopeOf(type)` whose `meta.type` equals the given type and whose `body` passes `BODY[type]`.
6. WHEN a MessageType value is added to or removed from the Message_Table, THE Protocol_Package SHALL fail its compile or test step until the BODY_Map, SIGNER_Map and metadata record are updated for that value.
7. THE SIGNER_Map SHALL map `hello` to `challenge`, `roster.update` to `owner`, every row that the Message_Table marks as signed by node to `node`, every row marked `–` to `none`, and every row signed by a device, watch or viewer to `device`.
8. THE SIGNER enum SHALL keep exactly the five values `device`, `owner`, `node`, `none` and `challenge`, and the value `device` SHALL mean "signed by a roster key of kind device (Full, watch or viewer)"; THE Verifier, not the Protocol_Package, SHALL check the caps of that signer (§12.2).
9. THE Protocol_Package SHALL export the helper `signerOf(type, body)` that returns the signer of an Envelope and the helper `persistOf(type, body)` that returns the persist flag of an Envelope, both resolving the per-type values of the SIGNER_Map and the metadata record.
10. THE per-type metadata record and the SIGNER_Map SHALL state for `bot.tool` that the signer and the Persist_Flag depend on `body.status`: `completed` and `failed` are persisted and signed by `node`; `pending` and `in_progress` are not persisted and not signed (`none`); and `signerOf` and `persistOf` SHALL return these values.

### Requirement 2: Envelope shape and strict Meta

**User Story:** As a verifier author, I want a fixed envelope shape with a strict Meta, so that unknown or tampered routing fields are rejected.

Implements §6.1, §6.2 (Base schemas `Meta`, `Envelope`).

#### Acceptance Criteria

1. THE Protocol_Package SHALL export an Envelope schema with the fields `v` (literal `1`), `meta`, `body` (unknown), `sig` (optional) and `relay` (optional).
2. THE Meta schema SHALL declare the fields `id`, `ts`, `space`, `room?`, `bot?`, `node?`, `epoch?`, `type`, `to`, `persist`, `prompt?`, `mentions?` and `leaseEpoch?` with the types given in §6.2.
3. THE Meta schema SHALL be declared with `.strict()`.
4. IF a Meta object contains a field that is not declared in the Meta schema, THEN THE Protocol_Package SHALL reject the Envelope with the error code `E_SCHEMA_INVALID`.
5. THE Meta schema SHALL require `ts` to be a positive integer, `epoch` to be a non-negative integer, `mentions` to hold at most 16 Ulid values, and `leaseEpoch` to be an integer.
6. WHEN an Envelope is parsed, THE Protocol_Package SHALL validate `body` against `BODY[meta.type]`.
7. IF `body` fails `BODY[meta.type]`, THEN THE Protocol_Package SHALL reject the Envelope with the error code `E_SCHEMA_INVALID` and report the failing field path without including the body content.
8. IF `meta.to` starts with `device:` and `meta.persist` is `true`, THEN THE Protocol_Package SHALL reject the Envelope with the error code `E_SCHEMA_INVALID`, because `device:<memberId>` targets are never persisted (§6.2 `To`).
9. WHEN an Envelope is serialized with the Protocol_Package and parsed again, THE Protocol_Package SHALL produce a value deeply equal to the original (round-trip).
10. IF `meta.type` is not a MessageType value, THEN THE Protocol_Package SHALL reject the Envelope with the error code `E_SCHEMA_INVALID` (resolved decision 18).
11. THE Protocol_Package SHALL enforce cross-field checks of the Envelope (persist match, device-target-not-persisted) in the schema of this package (resolved decision 10).

### Requirement 3: Signature scope data contract and relay fields (SI-4)

**User Story:** As a security reviewer, I want the data contract to say which fields are signed and which are not, so that no component can base a security decision on relay-added data.

Implements §6.1 (signature scope, relay fields), SI-4, SI-3 (data side only), §21.1 PBT #6 (data side).

#### Acceptance Criteria

1. THE Protocol_Package SHALL document and export a type `SignatureScope` equal to `{v, meta, body}`.
2. THE Protocol_Package SHALL export a pure function that returns the Signature_Scope of an Envelope without the `sig` and `relay` fields.
3. WHEN the `relay` field of an Envelope is changed, THE Signature_Scope returned for that Envelope SHALL remain deeply equal to the previous result.
4. WHEN the `sig` field of an Envelope is changed, THE Signature_Scope returned for that Envelope SHALL remain deeply equal to the previous result.
5. THE Relay_Fields schema SHALL declare `seq?` (integer), `recvTs` (integer), `root?` (Ulid), `forwardDepth?` (integer), `budgetLeft?` (integer) and `from?` (MemberId).
6. THE Protocol_Package SHALL state in the doc comment of the Relay_Fields schema that receivers SHALL NOT use `relay.*` for security decisions (SI-4), and that `relay.from` is for routing and denial-of-service limits only and is never a security decision.
7. THE Sig schema SHALL declare `by` (MemberId), `alg` (literal `ES256`) and `value` (string).
8. THE Protocol_Package SHALL export no function that computes, verifies or canonicalizes a signature, because signing behavior belongs to S-crypto.

### Requirement 4: Base schemas

**User Story:** As a developer, I want the base value schemas defined once, so that identifiers and routing targets are validated the same way everywhere.

Implements §6.2 (Base schemas in `packages/protocol/src/base.ts`).

#### Acceptance Criteria

1. THE Protocol_Package SHALL declare the base schemas in `packages/protocol/src/base.ts`.
2. THE `Ulid` schema SHALL accept only strings matching `^[0-9A-HJKMNP-TV-Z]{26}$`.
3. THE `MemberId` schema SHALL accept strings of length 1 to 64.
4. THE `PaneRef` schema SHALL accept only strings matching `^[a-z0-9-]+/[A-Za-z0-9:_-]+$` (nodeId/paneId).
5. THE `To` schema SHALL accept only the literals `relay` and `devices`, or a string starting with `device:`, `node:` or `bot:`.
6. THE `PromptKind` schema SHALL accept only `task`, `return` and `summary`.
7. THE `PromptMeta` schema SHALL declare `promptId` (Ulid), `replyTo` (Ulid or null), `kind` (PromptKind), `to` (Ulid), `requires` (array of CapTag, at most 8 entries, default empty) and `handoffMode` (`assign` or `transfer`, default `assign`).
8. THE `CapTag` schema SHALL accept only `gpu`, `local-files`, `cloud`, `autonomous`, `git-only`, `can-approve`, `private`, `untrusted` and `no-handoff`.
9. WHEN a value that does not match its base schema is parsed, THE Protocol_Package SHALL reject the value with a zod error.

### Requirement 5: Version and size gate before any other processing

**User Story:** As a relay or node operator, I want unsupported versions and oversized payloads rejected first, so that no further parsing cost is spent on them.

Implements §20 row 1 R2, §6.9 (`E_UNSUPPORTED_VERSION`, `E_PAYLOAD_TOO_LARGE`), §6.2 (limits).

#### Acceptance Criteria

1. THE Protocol_Package SHALL export an entry function that accepts a raw message (string or bytes) and returns either a parsed Envelope or an error object carrying an ErrorCode.
2. IF the UTF-8 byte length of the raw frame, measured before `JSON.parse`, is larger than the envelope limit of 256 KB, THEN THE entry function SHALL return `E_PAYLOAD_TOO_LARGE` before any JSON parsing or schema validation.
3. IF the size check passes and the parsed `v` is not equal to `1` (the size check runs first, then the version check, resolved decision 11), THEN THE entry function SHALL return `E_UNSUPPORTED_VERSION` before validating `meta`, `body`, `sig` or `relay`.
4. WHEN the version and size checks pass, THE entry function SHALL validate the Envelope as described in Requirement 2.
5. IF a decoded console frame `data` field is larger than 64 KB, THEN THE Protocol_Package SHALL report `E_PAYLOAD_TOO_LARGE`.
6. IF an attachment `text` field is larger than 8 KB, THEN THE Protocol_Package SHALL report `E_PAYLOAD_TOO_LARGE`.
7. THE size limits used by this gate SHALL be read from the Limits_Module and SHALL NOT be repeated as literals elsewhere.
8. IF the raw message is not valid JSON, THEN THE entry function SHALL return `E_SCHEMA_INVALID`.

### Requirement 6: Message catalogue metadata (persist, direction, signed by)

**User Story:** As a relay author, I want the persist flag, direction and signer of every type declared in data, so that routing and verification code does not hard-code them.

Implements §6.2 (Message table columns Direction, persist, Signed by), §6.1 ("Who signs what"), §12.2 (data only).

#### Acceptance Criteria

1. THE Protocol_Package SHALL record the Persist_Flag of each MessageType exactly as the `persist` column of the Message_Table.
2. THE Protocol_Package SHALL record `persist: true` for the types listed with ✓ in the Message_Table, `persist: false` for types listed with `–`, and, for `bot.tool`, `persist: true` when `body.status` is `completed` or `failed` and `persist: false` when `body.status` is `pending` or `in_progress` (resolved by `persistOf`, Requirement 1).
3. WHEN an Envelope is parsed whose `meta.persist` differs from the Persist_Flag of its `meta.type`, THE Protocol_Package SHALL reject the Envelope with the error code `E_SCHEMA_INVALID`.
4. THE Protocol_Package SHALL record the Direction of each MessageType exactly as the Direction column of the Message_Table.
5. THE Protocol_Package SHALL export a list of the types that are node-signed and stored: `bot.message.done`, `bot.tool` (final status), `bot.post`, `media.shared`, `bot.registered`, `bot.updated`, `bot.removed`, `bot.summary`, `bot.worked_for`, `node.configured`, `node.paused`, `bot.commands`, `bot.rewound`, `bot.terminalState`, `bot.terminalReturn`, `bot.terminalTurn`.
6. THE Protocol_Package SHALL export a list of the types that are node-signed and not stored: `media.ready`, `media.stored`, `bot.unsupported` and every reply addressed to `device:<requester>` that §6.1 lists as node-signed (`node.rootsListing`, `fs.listing`, `ws.changesListing`, `ws.diffContent`, `fs.treeListing`, `fs.content`, `bot.rewindPointsListing`, `bot.rewindPreviewListing`, `voice.text`).
7. THE Protocol_Package SHALL export a list of the types that are not signed: `bot.message.delta`, `console.frame`, `bot.state`, `ping`, `pong`, `media.chunk`, `media.data`, `media.ack` in both directions, and `bot.tool` with `status` `pending` or `in_progress`.
8. THE Protocol_Package SHALL declare in a doc comment that receivers trust the bytes of unsigned `media.*` messages only when the bytes hash to the signed `sha256` (C74).
9. THE Protocol_Package SHALL NOT include any cap-matrix decision logic, because cap checks belong to the Verifier (§12.2).
10. THE Protocol_Package SHALL declare every node-originated reply addressed with `meta.to = "device:<requester>"` as node-signed and not persisted, except `crypt.listing`, which §6.2 declares as direction `R→D` without a signature and which keeps the §6.2 values, because the relay answers from its crypt-index and holds no signing key (resolved decision 19).

### Requirement 7: Connection and housekeeping messages

**User Story:** As a node and PWA author, I want the connection-level messages declared, so that hello, ping, ack and snapshot interoperate.

Implements §6.2 rows `hello`, `ping`/`pong`, `ack`, `snapshot`, supporting shapes `NodeCaps`, `MemberView`.

#### Acceptance Criteria

1. THE BODY_Map entry for `hello` SHALL declare `kind` (`device` or `node`), `lastSeq` (integer), `lastAckedId?` (Ulid), `nodeId?`, `herdrVersion?`, `bots?` (array of BotSummary), `leasesHeld?` (array of `{sessionKey, leaseEpoch}`) and `caps?` (NodeCaps).
2. THE NodeCaps schema SHALL declare `cloudHost?` (boolean) and `voice?` as `{engine: "whisper-local"|"cloud", model: string, ready: boolean}`.
3. THE BODY_Map entries for `ping` and `pong` SHALL each declare `{t: integer}`.
4. THE BODY_Map entry for `ack` SHALL declare `{id: Ulid, seq?: integer}`.
5. THE BODY_Map entry for `snapshot` SHALL declare `seq`, `rooms` (Room[]), `bots` (Bot[]), `openApprovals` (ApprovalView[]), `recentEvents` (Envelope[]), `leases` (LeaseView[]), `members` (MemberView[]) and `frozen` (string[]).
6. THE SIGNER_Map SHALL map `hello` to `challenge`, and `ping`, `pong`, `ack` and `snapshot` to `none`.
7. THE Protocol_Package SHALL declare `hello`, `ping`, `pong` and `ack` as not persisted, and SHALL declare `snapshot` as not persisted with direction `R→D`.
8. THE Protocol_Package SHALL declare the `hello` check "`kind` must match the roster" as out of scope for the schema, because it is performed by the Verifier.

### Requirement 8: Chat, prompt and streaming messages

**User Story:** As a chat client author, I want user messages, bot posts, prompt lifecycle and streaming messages declared with their limits, so that every client renders and validates them identically.

Implements §6.2 rows `user.message`, `bot.post`, `prompt.queued/started/done`, `bot.message.delta`, `bot.message.done`, `bot.tool`, `bot.state`; SI-9 (data side).

#### Acceptance Criteria

1. THE BODY_Map entry for `user.message` SHALL declare `text` (string, at most 16,000 characters), `by` (`phone`, `desktop`, `watch` or `pane-unverified`), `attachments?` (array of Attachment), `media?` (array of MediaRef, at most 4) and `via?` (literal `voice`).
2. THE Protocol_Package SHALL declare the `user.message` direction as `D→R→N`, persisted, signed by `device`.
3. IF `user.message.text` is longer than 16,000 characters, THEN THE Protocol_Package SHALL reject the Envelope with the error code `E_SCHEMA_INVALID`.
4. THE Limits_Module SHALL export the watch free-text limits: 140 characters for a roster quick message and 280 characters for a confirmed voice transcript (`via: "voice"`).
5. WHERE the sender cap is `watch`, THE Protocol_Package SHALL export a pure helper that returns true when `text` has at most 140 characters, or when `via` is `voice` and `text` has at most 280 characters.
6. THE Protocol_Package SHALL declare as out of scope for the schema that a watch `text` must equal an entry of the owner-signed `roster.quickMessages`, because that check needs roster data and belongs to the relay and node (SI-9).
7. THE BODY_Map entry for `bot.post` SHALL declare `{text: string}`, direction `N→R→D`, persisted, signed by `node`.
8. THE BODY_Map entries for `prompt.queued`, `prompt.started` and `prompt.done` SHALL each declare `promptId` (Ulid), `bot` (Ulid), `position?` (integer) and `stopReason?` (string), direction `N→R→D`, persisted, signer `none`.
9. THE BODY_Map entry for `bot.message.delta` SHALL declare `promptId`, `messageId` and `text`, direction `N→R→D`, not persisted, signer `none`.
10. THE BODY_Map entry for `bot.message.done` SHALL declare `promptId`, `messageId`, `text` and `stopReason`, direction `N→R→D`, persisted, signed by `node`.
11. THE BODY_Map entry for `bot.tool` SHALL declare `toolCallId`, `title`, `kind` (ToolKind), `status` (`pending`, `in_progress`, `completed` or `failed`), `diffs?` (Diff[]), `locations?` (Location[]) and `output?` (string, at most 32 KB), direction `N→R→D`, persisted and signed by `node` WHEN `status` is `completed` or `failed`, and not persisted and not signed WHEN `status` is `pending` or `in_progress`.
12. IF a `bot.tool` Envelope has a `meta.persist` value or a `sig` presence that does not match the rule of criterion 11 for its `body.status`, THEN THE Protocol_Package SHALL reject the Envelope with the error code `E_SCHEMA_INVALID`.
13. THE BODY_Map entry for `bot.state` SHALL declare `state` (BotState), `message?`, `queue` (integer), `room` (string) and `sessionRole` (`main` or `seat`), direction `N→R→D`, not persisted, signer `none`.
14. THE Protocol_Package SHALL declare the BotState enum with the values `dormant`, `starting`, `idle`, `working`, `blocked`, `waiting_write`, `restoring`, `migrating`, `offline`, `paused`, `terminal`, `needs_resolve`, `failed` and `closed` (§9).
15. THE Protocol_Package SHALL export the BotState urgency order `needs_resolve > blocked > terminal > waiting_write > working > idle` as data for the UI rule of the `bot.state` row.

### Requirement 9: Bot lifecycle, registry and bot-management commands

**User Story:** As a node and relay author, I want bot registration and bot-management messages declared, so that bots, names and commands stay consistent across all components.

Implements §6.2 rows `bot.registered/updated/removed`, `bot.summary`, `bot.commands`, `bot.spawn`, `bot.move`, `bot.configure`, `bot.kill`, `bot.cancel`, `bot.worked_for`, `bot.unsupported`; P1-D13.

#### Acceptance Criteria

1. THE BODY_Map entries for `bot.registered`, `bot.updated` and `bot.removed` SHALL each declare `botId` (Ulid), `name`, `workspaceKey`, `kind` (`project`, `assistant` or `standalone`), `parent?` (Ulid), `children` (Ulid[]), `agent`, `tier`, `caps` (string[]), `rewind?` (`{conversation, separate, code}` booleans), `autopilot?` (`{on: boolean, until?: integer}`), `terminal?` (`{phoneExit: boolean}`), `seats` (array of `{room, mode: "process"|"swap", state}`) and `replyTo?` (Ulid).
2. THE Protocol_Package SHALL declare these three types as direction `N→R→D`, persisted, signed by `node`.
3. THE Protocol_Package SHALL export a bot `name` schema that accepts only strings matching `^[a-z0-9][a-z0-9-]{0,31}$` (§4.8 name rule used by P1-D13).
4. THE BODY_Map entry for `bot.summary` SHALL declare `room`, `text` (at most 2 KB) and `untrustedInputs` (boolean), direction `N→R→D`, persisted, signed by `node`.
5. THE BODY_Map entry for `bot.commands` SHALL declare `bot` (Ulid), `source` (`acp`, `files` or `none`) and `commands` (at most 200 entries), where each command declares `name` matching `^[a-z0-9][a-z0-9:_-]{0,63}$`, `description` (at most 200 characters), `hint?` (at most 80 characters), `kind` (`skill`, `prompt` or `command`) and `terminal?` (boolean).
6. THE Protocol_Package SHALL declare `bot.commands` as direction `N→R→D`, persisted, signed by `node`.
7. THE BODY_Map entry for `bot.spawn` SHALL declare `kind` (`project`, `assistant` or `standalone`), `workspace` (string), `createFolder?` (boolean), `name`, `agent` (`kiro`, `claude`, `local-llm`, `grok` or `shell`) and `instructions?` (string, at most 8000 characters).
8. WHERE `bot.spawn.createFolder` is set, THE Protocol_Package SHALL export a folder-name schema that accepts only strings matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`.
9. THE BODY_Map entry for `bot.move` SHALL declare `{bot: Ulid, workspace: string}`.
10. THE BODY_Map entry for `bot.configure` SHALL declare `bot` (Ulid), `name?`, `instructions?` (at most 8000 characters), `agent?` (string), `autopilot?` (`{on: boolean, until?: integer}`) and `aliases?` (at most 5 strings, each at most 32 characters).
11. THE BODY_Map entries for `bot.kill` and `bot.cancel` SHALL each declare `bot` (Ulid), `room?` (string) and `reason?` (string).
12. THE Protocol_Package SHALL declare `bot.spawn`, `bot.move`, `bot.configure`, `bot.kill` and `bot.cancel` as direction `D→R→N`, persisted, with signer `device` (resolved decision 2: "owner or `device`" maps to `device`, and the Verifier checks the cap).
13. THE BODY_Map entry for `bot.worked_for` SHALL declare `bot` (Ulid), `fromRoom`, `requester` (Ulid), `promptId` (Ulid) and `task` (at most 200 characters), direction `N→R→D`, persisted, signed by `node`.
14. THE BODY_Map entry for `bot.unsupported` SHALL declare `bot`, `room`, `kind` (at most 64 characters) and `count` (integer), direction `N→R→D`, not persisted, signed by `node`.
15. THE Protocol_Package SHALL declare the checks "workspace under a root", "target folder has no bot", "agent detected on the node" and "launch argv never contains `--trust-all-tools`" as out of scope for the schema, because they are performed by the node (SI-2 data is covered by Requirement 21).

### Requirement 10: Approval messages

**User Story:** As an approval-flow author, I want the approval messages and option shapes declared exactly, so that the signed request, the response and the resolution bind to the same data.

Implements §6.2 rows `approval.request`, `approval.respond`, `approval.resolved`, `approval.rejected_late`; supporting shapes `Option`, `ToolKind`; P1-D15 (data side).

#### Acceptance Criteria

1. THE BODY_Map entry for `approval.request` SHALL declare `approvalId` (Ulid), `bot` (Ulid), `sessionId`, `epoch` (integer), `promptId?` (Ulid), `turnOrigin`, `autopilot?` (boolean), `requestKind` (`tool` or `spawn`, default `tool`), `title`, `kind` (ToolKind), `detail`, `summary` (at most 120 characters), `options` (array of Option) and `expiresAt` (integer).
2. THE `turnOrigin` field SHALL accept only `user`, `handoff`, `return`, `cloud`, `summary`, `nudge`, `pane` and `none`.
3. THE `detail` field SHALL declare `command?`, `cwd?`, `diff?` and `raw?` (unknown).
4. THE Option schema SHALL declare `optionId` (string), `name` (string) and `kind` (`allow_once`, `allow_always`, `reject_once` or `reject_always`).
5. THE ToolKind schema SHALL accept only `read`, `edit`, `delete`, `move`, `search`, `execute`, `think`, `fetch` and `other`.
6. THE BODY_Map entry for `approval.respond` SHALL declare `approvalId`, `epoch` (integer), `optionId` and `requestHash` (string).
7. THE Protocol_Package SHALL declare `approval.respond` as direction `D→R→N→G`, persisted, with signer `device` (must be signed).
8. THE BODY_Map entry for `approval.resolved` SHALL declare `approvalId`, `optionId`, `optionKind` and `by`, where `by` accepts `device:<id>`, `watch:<id>`, `autopilot`, `timeout` or `expired`.
9. THE BODY_Map entry for `approval.rejected_late` SHALL declare `approvalId` and `reason` (`already_resolved`, `stale_epoch`, `expired` or `unknown`).
10. THE Protocol_Package SHALL declare `approval.request`, `approval.resolved` and `approval.rejected_late` as direction `N→R→D`, persisted, signed by `node`.
11. THE Protocol_Package SHALL declare as out of scope for the schema: `optionId` membership in the request options (`E_OPTION_INVALID`), `ts < expiresAt`, epoch match, `requestHash` match, and the watch restriction to `allow_once`/`reject_once` (SI-9), because these are Verifier checks.
12. THE Protocol_Package SHALL declare the literal token `autopilot` for `approval.resolved.by` only in the protocol package, in line with the SI-1 hook rule.

### Requirement 11: Rooms, groups and the Handoff Packet

**User Story:** As a group-chat author, I want room messages and the handoff packet declared in one place, so that relay, nodes and bots exchange the same format.

Implements §6.2 rows `room.handoff/return`, `room.freeze`, `room.create/rename`, `room.members`, `room.nudge`; §6.6 Handoff Packet; SI-10 (data side).

#### Acceptance Criteria

1. THE Protocol_Package SHALL export a Handoff_Packet schema with `promptId`, `root?`, `replyTo` (Ulid or null), `kind`, `from` (`{bot, botId, node}`), `to` (`{bot, botId}`), `mode` (`assign` or `transfer`, default `assign`), `task`, `refs?`, `attachments` (default empty array), `context?` and `constraints`, where `from.bot` and `to.bot` are bot names validated by the bot `name` rule, and `from.botId` and `to.botId` are Ulid values (resolved decisions 14 and 15).
2. THE Handoff_Packet `refs` field SHALL declare `repo?`, `branch?`, `pr?` (integer) and `commit?`.
3. THE Handoff_Packet `attachments` field SHALL be an array of Attachment whose total text size is at most 8 KB.
4. THE Handoff_Packet `constraints` field SHALL declare `forwardDepth`, `budgetLeft` and `requires` (array of CapTag).
5. THE BODY_Map entries for `room.handoff` and `room.return` SHALL both use the Handoff_Packet schema, direction `N→R→N` (and D), persisted, signed by `node`.
6. THE Protocol_Package SHALL export a helper that copies `promptId`, `replyTo`, `kind`, `requires` and `mode` from a Handoff_Packet into a `meta.prompt` object with `mode` mapped to `handoffMode`, sets `meta.prompt.to` to `to.botId` (the target botId, resolved decision 14), and takes `requires` from `constraints.requires`.
7. THE Protocol_Package SHALL declare as out of scope that the relay computes `root`, `forwardDepth` and `budgetLeft` itself and ignores sender values (loop-guard, S-relay-core).
8. THE BODY_Map entry for `room.freeze` SHALL declare `{room: string, frozen: boolean}`, direction `D→R(→N)`, persisted, signer `device`.
9. THE BODY_Map entry for `room.create` SHALL declare `room`, `name` (1 to 48 Unicode characters after trim, no newlines) and `members` (array of Ulid, at least 1).
10. THE BODY_Map entry for `room.rename` SHALL declare `{room, name}` with the same `name` rule as `room.create`.
11. THE BODY_Map entry for `room.members` SHALL declare `room`, `add?` (Ulid[]) and `remove?` (Ulid[]).
12. THE BODY_Map entry for `room.nudge` SHALL declare `room`, `bot` (Ulid) and `upToId` (Ulid), and SHALL require `meta.mentions` to be exactly `[bot]`.
13. THE Protocol_Package SHALL declare `room.create`, `room.rename`, `room.members` and `room.nudge` as persisted, direction `D→R` or `D→R→N` as given in the Message_Table, signer `device`.
14. THE Protocol_Package SHALL declare as out of scope the checks "groups only", "cloud bots cannot be added" (`E_CLOUD_NO_GROUPS`), "member has a T1/T2 seat" (`E_TIER_UNSUPPORTED`), "name unique per Space" and "watch/viewer `frozen` must be true", because these need runtime state or cap data.

### Requirement 12: Console and take-control messages

**User Story:** As a console UI author, I want the console messages and their size limits declared, so that frames and input are validated at the boundary.

Implements §6.2 rows `console.open/close/frame/takecontrol/input`.

#### Acceptance Criteria

1. THE BODY_Map entries for `console.open` and `console.close` SHALL each declare `{paneRef: PaneRef}`, direction `D→R→N`, not persisted, signer `device`.
2. THE BODY_Map entry for `console.frame` SHALL declare `paneRef`, `mode` (`snapshot` or `stream`), `data` (string, at most 64 KB), `hash`, `cols` (integer) and `rows` (integer), direction `N→R→D`, not persisted, signer `none`.
3. THE BODY_Map entry for `console.takecontrol` SHALL declare `paneRef`, `session` (Ulid) and `until` (integer), direction `D→R→N`, persisted, signer `device`.
4. THE Limits_Module SHALL export the take-control maximum duration of 10 minutes.
5. WHEN a `console.takecontrol` Envelope is parsed, THE Protocol_Package SHALL reject it with `E_SCHEMA_INVALID` if `body.until − meta.ts` is greater than 10 minutes.
6. THE BODY_Map entry for `console.input` SHALL declare `paneRef`, `session` (Ulid), `n` (integer), `text?` (string) and `keys?` (array of strings), direction `D→R→N`, not persisted, signer `device`.
7. THE Limits_Module SHALL export the console-input maximum age of 60 seconds (`now − ts ≤ 60 s`) as a constant for the Verifier.
8. THE Protocol_Package SHALL declare as out of scope for the schema: session expiry, `n` greater than the previous `n`, and the rule that `paneRef` must not belong to a `role='seat'` session (`E_SEAT_READ_ONLY`).
9. THE Protocol_Package SHALL export the named-key vocabulary rule for `console.input.keys` (enter, esc, tab, arrows, `ctrl+…`, single ASCII letters) as a schema, so that free text cannot be sent through `keys`.

### Requirement 13: Bot rewind and Terminal-mode messages

**User Story:** As an author of rewind and Terminal mode, I want those messages declared with their limits, so that the node and PWA agree on every field.

Implements §6.2 rows `bot.rewindPoints`, `bot.rewindPointsListing`, `bot.rewindPreview` (and its listing), `bot.rewind`, `bot.rewound`, `bot.terminal`, `bot.terminalState`, `bot.terminalReturn`, `bot.terminalResolve`, `bot.terminalTurn`.

#### Acceptance Criteria

1. THE BODY_Map entry for `bot.rewindPoints` SHALL declare `{bot: Ulid}`, direction `D→R→N`, not persisted, signer `device`.
2. THE BODY_Map entry for `bot.rewindPointsListing` SHALL declare `bot`, `sessionId` and `points` (at most 100 entries, newest first), where each point declares `promptId`, `text` (at most 120 characters), `at` (integer), `filesAfter` (integer or null), `conversation` (boolean) and `code` (boolean).
3. THE BODY_Map entry for `bot.rewindPreview` SHALL declare `bot`, `toPromptId` and `restore` (`both` or `code`), direction `D→R→N→G`, not persisted, signer `device`.
4. THE Protocol_Package SHALL declare a body schema for the answer `bot.rewindPreviewListing` with `bot`, `toPromptId`, `files` (at most 200 entries of `{path, action: "restore"|"delete"}`) and `filesHash`, addressed with `meta.to = "device:<requester>"`, direction `N→R→D`, not persisted and signed by `node` (resolved decision 4).
5. THE BODY_Map entry for `bot.rewind` SHALL declare `bot`, `toPromptId`, `restore` (`both`, `conversation` or `code`) and `filesHash?`, direction `D→R→N→G`, persisted, signer `device`.
6. IF `bot.rewind.restore` is `both` or `code` and `filesHash` is absent, THEN THE Protocol_Package SHALL reject the Envelope with `E_SCHEMA_INVALID`.
7. THE BODY_Map entry for `bot.rewound` SHALL declare `bot`, `toPromptId`, `restore`, `filesRestored` (integer), `filesSkipped` (integer), `promptText` and `sessionId`, direction `N→R→D`, persisted, signed by `node`.
8. THE BODY_Map entry for `bot.terminal` SHALL declare `bot`, `action` (`enter` or `exit`) and `run?` matching `^/[a-z0-9][a-z0-9:_-]{0,63}( [\x20-\x7e]{0,200})?$`, direction `D→R→N`, persisted, signer `device`.
9. THE BODY_Map entry for `bot.terminalState` SHALL declare `bot`, `state` (`entering`, `idle`, `busy`, `exiting` or `off`), `by`, `enteredAt` (integer), `sessionId` and `reason?`, direction `N→R→D`, persisted, signed by `node`.
10. THE BODY_Map entry for `bot.terminalReturn` SHALL declare `bot`, `enteredAt`, `exitedAt`, `turns` (integer), `interrupted` (boolean), `changes` (`{files, added, removed}` or null), `settingsChanged?`, `sessionDiverged?`, `model?` and `cacheCostUsd?`.
11. THE `settingsChanged` field of `bot.terminalReturn` SHALL be an array of `{file, created, added: {path, value}[], si2WouldPass}`.
12. THE BODY_Map entry for `bot.terminalResolve` SHALL declare `bot`, `settings?` (`remove` or `keep`), `session?` (`follow` or `keep`) and `model?` (`revert` or `keep`), direction `D→R→N`, persisted, signer `device`.
13. THE BODY_Map entry for `bot.terminalTurn` SHALL declare `bot`, `room`, `role` (`user` or `assistant`), `text` (at most 32 KB), `at`, `enteredAt` and `n`, direction `N→R→D`, persisted, signed by `node`.
14. THE Protocol_Package SHALL declare `bot.terminalReturn` and `bot.terminalTurn` content as untrusted display data, and SHALL document in the `bot.terminalTurn` doc comment that it is excluded from context building (SI-6).
15. THE Protocol_Package SHALL declare as out of scope the node checks of these rows (idle state, write lock, `E_TERMINAL_*`, `E_REWIND_*`, `E_BOT_BUSY`).

### Requirement 14: Node configuration, filesystem, workspace, crypt and cloud-move messages

**User Story:** As a settings, file-browser and Crypt UI author, I want the node configuration and listing messages declared with their limits, so that responses addressed to one device validate consistently.

Implements §6.2 rows `node.roots`, `node.rootsListing`, `node.configure`, `node.configured`, `node.paused`, `fs.list`, `fs.listing`, `ws.changes`, `ws.diff`, `ws.changesListing`, `ws.diffContent`, `fs.tree`, `fs.read`, `fs.treeListing`, `fs.content`, `crypt.*`, `cloud.move`; P1-D15 (`E_SCHEMA_INVALID` for 0 and 241).

#### Acceptance Criteria

1. THE BODY_Map entry for `node.configure` SHALL declare `node`, `approvalTimeoutMin?` (integer 1 to 240), `autopilotAsk?` (at most 50 strings, each at most 200 characters) and `autopilotOff?` (array of `git-push`, `git-destroy`, `publish`, `rm-recursive`, `pipe-to-shell`, `network-out`, `remote-install` or `system`).
2. IF `node.configure.approvalTimeoutMin` is 0 or 241, THEN THE Protocol_Package SHALL reject the Envelope with `E_SCHEMA_INVALID` (P1-D15).
3. THE BODY_Map entry for `node.configured` SHALL declare `node`, `approvalTimeoutMin`, `autopilotAsk` and `autopilotOff`, direction `N→R→D`, persisted, signed by `node`.
4. THE BODY_Map entry for `node.paused` SHALL declare `{node, paused: boolean}`, direction `N→R→D`, persisted, signed by `node`.
5. THE BODY_Map entry for `node.roots` SHALL declare `node`, `add?` (string[]) and `remove?` (string[]), direction `D→R→N`, not persisted, signer `device`.
6. THE BODY_Map entry for `node.rootsListing` SHALL declare `{roots: string[]}`, addressed with `meta.to = "device:<requester>"`, not persisted, signed by `node`.
7. THE BODY_Map entry for `fs.list` SHALL declare `{node, path}`, and the entry for `fs.listing` SHALL declare `path`, `dirs` (at most 200 entries of `{name, kind: "folder"|"assistant", hasBot, botId?}`) and `truncated`, both not persisted; `fs.listing` is direction `N→R→D` and signed by `node`, and `fs.list` is signed by `device`.
8. THE BODY_Map entries for `ws.changes` and `ws.diff` SHALL declare `{bot}` and `{bot, path}`, not persisted, signer `device`.
9. THE BODY_Map entry for `ws.changesListing` SHALL declare `files`, each entry with `path`, `status`, `adds`, `dels` and optional `by` (`{bot, room, source: "locations"|"lock_window"|"terminal", promptId?, approvalId?, approvedBy?, at}`).
10. THE BODY_Map entry for `ws.diffContent` SHALL declare `path`, `diff` (at most 256 KB) and `truncated`.
11. THE BODY_Map entries for `fs.tree` and `fs.read` SHALL declare `{bot, path}`, and the entries for `fs.treeListing` and `fs.content` SHALL declare `{path, entries: {name, kind, size, git?}[]}` and `{path, text (at most 256 KB), truncated}`.
12. THE Protocol_Package SHALL declare every node listing and content response in this requirement (`node.rootsListing`, `fs.listing`, `ws.changesListing`, `ws.diffContent`, `fs.treeListing`, `fs.content`) as direction `N→R→D`, not persisted, signed by `node`, and addressed with `meta.to = "device:<requester>"` (resolved decision 4).
13. THE BODY_Map entry for `crypt.snapshot` SHALL declare `{sessions: SessionRef[]}`, direction `N→R`, not persisted, signer `none`; `crypt.list` SHALL declare `{node?}`, direction `D→R`, not persisted; `crypt.listing` SHALL declare `{sessions: CryptEntry[]}` with `meta.to = "device:<requester>"`, direction `R→D`, not persisted and signer `none`, as §6.2 states (this differs from the node-signed rule for other `device:<requester>` replies, because the relay answers from its crypt-index and holds no signing key; see resolved decisions 4 and 19).
14. THE BODY_Map entry for `crypt.resurrect` SHALL declare `{sessionRef: SessionRef, fork?: boolean}`, direction `D→R→N`, persisted, signer `device`.
15. THE BODY_Map entry for `cloud.move` SHALL declare `{bot, toNode, force?}`, direction `D→R→N`, persisted, signer `device`.
16. THE Protocol_Package SHALL declare as out of scope the path-safety checks (realpath, roots, deny-list, git repo, `E_PATH_NOT_DIR`, `E_FILE_DENIED`, `E_NOT_GIT`) and `toNode` having cap `cloud-host`, because the node and relay perform them.

### Requirement 15: Media and voice messages

**User Story:** As an author of image, video and voice features, I want the media transfer and voice messages declared with their size rules, so that chunked transfers and transcripts validate at the boundary.

Implements §6.2 rows `voice.transcribe`, `voice.text`, `media.shared`, `media.get`, `media.ready`, `media.chunk`, `media.ack`, `media.begin`, `media.data`, `media.stored`; supporting shapes `MediaRef`, `Attachment`; §21.1 PBT #26 (data side).

#### Acceptance Criteria

1. THE MediaRef schema SHALL declare `mediaId` (Ulid), `node`, `name` (at most 200 characters), `mime`, `bytes` (integer), `sha256`, `w?`, `h?`, `durationMs?`, `thumb` (base64 WebP of at most 32 KB, or null) and `origin` (`bot` or `device`), and SHALL contain no field that holds a filesystem path.
2. THE `Basename` schema SHALL accept only strings matching `^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$`.
3. THE BODY_Map entry for `media.shared` SHALL declare `media` (MediaRef), `bot`, `promptId?`, `caption?` (at most 500 characters) and `preview` (boolean), direction `N→R→D`, persisted, signed by `node`.
4. THE BODY_Map entry for `media.get` SHALL declare `mediaId`, `variant` (`full` or `preview`) and `fromChunk?` (integer), direction `D→R→N`, not persisted, signer `device`.
5. THE BODY_Map entry for `media.ready` SHALL declare `mediaId`, `variant`, `bytes`, `sha256`, `chunks` (integer) and `mime`, direction `N→R→D`, not persisted, signed by `node`.
6. THE BODY_Map entry for `media.chunk` SHALL declare `mediaId`, `variant`, `seq` (integer) and `data` (base64, at most 32 KB decoded), not persisted, signer `none`.
7. THE BODY_Map entry for `media.ack` SHALL declare an identifier (`mediaId` or `uploadId`) and `upTo` (integer), not persisted, with signer `none` in both directions, because `media.ack` is flow control only and integrity comes from the signed `sha256` (resolved decision 5).
8. THE BODY_Map entry for `media.begin` SHALL declare `uploadId` (Ulid), `bot` (Ulid), `name` (Basename), `mime`, `bytes` (integer) and `sha256`, direction `D→R→N`, not persisted, signer `device`.
9. THE BODY_Map entry for `media.data` SHALL declare `uploadId`, `seq` (integer) and `data` (base64, at most 32 KB decoded), not persisted, signer `none`.
10. THE BODY_Map entry for `media.stored` SHALL declare `{uploadId, media: MediaRef}`, direction `N→R→D`, not persisted, signed by `node`.
11. THE BODY_Map entry for `voice.transcribe` SHALL declare `id` (Ulid), `room?`, `mime` (`audio/webm`, `audio/mp4`, `audio/ogg`, `audio/wav` or `audio/opus`), `durationMs` (integer, at most 30,000) and `audio` (base64, at most 144 KB decoded), direction `D→R→N`, not persisted, signer `device`, addressed with `meta.to = "relay"` (resolved decision 8).
12. THE BODY_Map entry for `voice.text` SHALL declare `id`, `text` (at most 2000 characters), `engine` (`whisper-local` or `cloud`), `model`, `ms` (integer) and `fixedMentions` (array of `{said, handle}`), direction `N→R→D`, not persisted, signed by `node`, addressed with `meta.to = "device:<requester>"`.
13. THE Protocol_Package SHALL declare the `media.get`, `media.ready`, `media.chunk`, `media.ack`, `media.begin`, `media.data` and `media.stored` types with `persist: false`.
14. THE Protocol_Package SHALL declare as out of scope the SHA-256 check of joined bytes, magic-byte checks, `relay.from` matching, chunk windowing and `E_MEDIA_*` decisions, because the node and device perform them.

### Requirement 16: Pairing, roster, lease, push, system and node-capability messages

**User Story:** As an author of pairing, leasing and notifications, I want these messages declared in the protocol package, so that every adapter shares the same shapes.

Implements §6.2 rows `roster.update`, `pair.ticket/offer/complete`, `lease.*`, `push.subscribe/unsubscribe`, `system.card`, `node.caps`; supporting shapes `RosterEntry`, `Cap`, `MemberView`.

#### Acceptance Criteria

1. THE BODY_Map entry for `roster.update` SHALL declare `version` (integer), `entries` (RosterEntry[]), `revoked` (MemberId[]), `quickMessages` (at most 8 strings, each at most 140 characters) and `signature` (string), direction `D→R→N`, persisted, signer `owner`.
2. THE RosterEntry schema SHALL declare `memberId`, `kind` (`device` or `node`), `signPub` (JWK), `caps` (array of Cap), `hostPriority?` (integer), `label` (string) and `addedAt` (integer).
3. THE Cap schema SHALL accept only `owner`, `device`, `watch`, `viewer`, `node` and `cloud-host`.
4. THE BODY_Map entry for `pair.ticket` SHALL declare `{ticketId}`; `pair.offer` SHALL declare `members` (1 to 2 entries of `{memberKind, signPub, caps, hostPriority?, label}`); `pair.complete` SHALL declare `ownerPub`, `rosterEntries` (RosterEntry[]) and `hmac`.
5. THE Protocol_Package SHALL declare `pair.ticket`, `pair.offer` and `pair.complete` as not persisted, with signer `owner` for `pair.complete` and `none` for the other two.
6. THE BODY_Map entries for `lease.acquire`, `lease.granted`, `lease.release`, `lease.revoke` and `lease.lost` SHALL each declare `sessionKey`, `bot` (Ulid), `leaseEpoch?` (integer), `paneRef?` (PaneRef) and `reason?`, direction `N↔R`, not persisted, signer `none`.
7. THE Protocol_Package SHALL define no `lease.renew` message type.
8. THE BODY_Map entries for `push.subscribe` and `push.unsubscribe` SHALL each declare `endpoint`, `keys` (`{p256dh, auth}`) and `expirationTime?` (integer), direction `D→R`, not persisted, signer `device`.
9. THE BODY_Map entry for `system.card` SHALL declare `kind` (`respawned`, `host_moved`, `queue_dropped`, `quota`, `revoked` or `info`), `text` and `ref?`, direction `R→D`, persisted, signer `none`.
10. THE BODY_Map entry for `node.caps` SHALL declare `{nodeId, caps: NodeCaps}`, direction `N→R→D`, not persisted, signer `none`.
11. THE MemberView schema SHALL declare `memberId`, `kind` (`device` or `node`), `label`, `caps?` (NodeCaps), `online` (boolean), `lastSeen` (integer) and `paused?` (boolean).
12. THE Protocol_Package SHALL declare in doc comments that `node.caps` and `system.card` data are for display and routing and are never used for a security decision.
13. THE Protocol_Package SHALL declare as out of scope the HMAC computation of `pair.complete`, roster version comparison, and ticket consumption, because S-pairing-trust and S-crypto own them.

### Requirement 17: Supporting enums and shapes

**User Story:** As a developer, I want all shared sub-shapes defined once, so that no app has to restate them.

Implements §6.2 (Supporting enums/shapes), §9 (BotState).

#### Acceptance Criteria

1. THE Protocol_Package SHALL export the schemas `MemberView`, `ToolKind`, `Option`, `BotState`, `CapTag`, `Attachment`, `MediaRef`, `SessionRef`, `CryptEntry`, `Cap`, `RosterEntry` and `NodeCaps`.
2. THE Attachment schema SHALL declare `name`, `mime`, `text` (at most 8 KB) and `truncated` (boolean).
3. THE SessionRef schema SHALL declare `agentKind` (`kiro`, `claude` or `other`), `sessionId`, `cwd`, `nodeId`, `location` (`local` or `cloud`), `title?` and `lastActive?`.
4. THE CryptEntry schema SHALL declare `botId`, `workspaceKey`, `botName`, `role` (`main` or `seat`), `room?` and `session` (SessionRef).
5. THE Protocol_Package SHALL export the schemas for `Diff`, `Location`, `Room`, `Bot`, `ApprovalView`, `LeaseView`, `BotSummary`, `Tier`, `BotId` and `JWK`, which §6.2 references without defining, with these sources (resolved decision 1): `Diff` and `Location` follow the ACP tool-call types; `Room`, `Bot`, `ApprovalView`, `LeaseView` and `BotSummary` follow §10; `Tier` accepts the `agents.json` tier values `t0`, `t1` and `t2`; `BotId` is a Ulid; `JWK` is an EC P-256 public JWK.
6. THE `tier` fields of `bot.registered`, `bot.updated` and `bot.removed` SHALL use the Tier schema, and the `signPub` fields of RosterEntry and `pair.offer` SHALL use the JWK schema.
7. WHEN a supporting shape is used by more than one message body, THE Protocol_Package SHALL define it once and reference it from every body schema.

### Requirement 18: Error code catalogue and error message

**User Story:** As a client author, I want every error code in one typed constant with its HTTP status and client action, so that error handling is consistent in the relay, node, PWA and sprite.

Implements §6.9, §6.2 row `error`, §6.7 (error body shape), P1-D13, P1-D15.

#### Acceptance Criteria

1. THE Protocol_Package SHALL export the Error_Catalogue as a typed constant (`as const`) with one entry per code listed in Appendix A.
2. THE Error_Catalogue entry for each code SHALL carry `code`, `raisedBy` (list of `relay`, `node`, `pwa`, `sprite`, `watch`, `device`, `app`, `all`), `http` (number or null), `meaning` and `clientAction`, using the texts of §6.9.
3. THE Protocol_Package SHALL derive the ErrorCode type from the keys of the Error_Catalogue.
4. THE BODY_Map entry for `error` SHALL declare `code` (ErrorCode), `message` (string), `ref?` (Ulid) and `retryAfter?` (integer), direction `R/N→D`, not persisted, signer `none`.
5. THE Protocol_Package SHALL export an error-body schema for HTTP responses of the form `{error: {code, message, retryAfter?}}` with the same ErrorCode type (§6.7).
6. WHERE an error carries extra data defined in §6.9 (`botId` for `E_WORKSPACE_TAKEN`, `suggestion` for `E_NAME_TAKEN`, `suggested` for `E_CAPABILITY_MISSING`), THE Protocol_Package SHALL provide an optional typed `data` object per code: `{botId}` for `E_WORKSPACE_TAKEN`, `{suggestion}` for `E_NAME_TAKEN` and `{suggested: Ulid[]}` for `E_CAPABILITY_MISSING` (resolved decision 3).
7. THE Protocol_Package SHALL export a helper that returns the HTTP status for an ErrorCode, returning no status for codes whose HTTP column is `–`.
8. IF an error `message` or `data` is built by the Protocol_Package helpers, THEN THE helpers SHALL NOT include message bodies, key material, or the content of the failing field (SI-12, §6.9 `E_SCHEMA_INVALID`).
9. WHEN a value that is not in the Error_Catalogue is parsed as an ErrorCode, THE Protocol_Package SHALL reject the value.
10. THE Error_Catalogue SHALL map `E_NAME_TAKEN` to HTTP 409 and `E_SCHEMA_INVALID` to HTTP 400 (P1-D13, P1-D15).
11. THE Error_Catalogue SHALL contain exactly the 84 codes of §6.9 listed in Appendix A, no more and no fewer, where a §6.9 row that names several codes (for example `E_TICKET_INVALID` / `E_TICKET_EXPIRED`) yields one entry per code.
12. THE Protocol_Package SHALL include a test that compares the Error_Catalogue keys to a snapshot of the §6.9 codes in both directions: every snapshot code SHALL exist in the catalogue, and every catalogue code SHALL exist in the snapshot.

### Requirement 19: Sprite message schemas (tolerant)

**User Story:** As a sprite and node author, I want the sprite protocol schemas declared tolerantly and additive-only, so that a sprite and a node of adjacent releases can talk to each other.

Implements §6.5 (`packages/protocol/src/sprite.ts`, C76, DECISION-54), §6.1 (Meta inside `event`).

#### Acceptance Criteria

1. THE Protocol_Package SHALL declare the Sprite_Schemas in `packages/protocol/src/sprite.ts`.
2. THE Sprite_Schemas SHALL use zod default stripping for unknown fields and SHALL NOT use `.strict()` on any sprite message schema.
3. WHEN a sprite-level message of an unknown message `type` is received (this does not apply to an Envelope with an unknown `meta.type`, which Requirement 2 rejects with `E_SCHEMA_INVALID`), THE Protocol_Package SHALL provide a parse result marking it as ignorable and SHALL NOT report an error.
4. WHEN a sprite message contains an unknown field, THE Sprite_Schemas SHALL strip the field and accept the message.
5. THE Sprite_Schemas SHALL declare new fields only as optional fields (additive-only rule).
6. THE `event` message body SHALL contain an Envelope whose `meta` is validated by the strict Meta schema of Requirement 2.
7. THE Sprite_Schemas SHALL declare the G→N `hello` message with `botId`, `role` (`main` or `seat`), `room?`, `sessionId?`, `paneId`, `pid`, `epoch`, `lastAckedId`, `mode` (`acp`, `exec` or `sdk`), `leaseEpoch?`, `spawnToken` and `build?`, and the swap-mode variant with `sessions` (array of `{sessionId, role, room, leaseEpoch}`).
8. THE Sprite_Schemas SHALL declare the messages `lock.acquire`, `lock.granted`, `lock.release` (`{toolCallId, approvalId?, sessionId?}`), `session.open` (`{id, room, seed?, fork?, resume?}`), `session.opened` (`{id, sessionId, room}`) and `session.lease` (`{id, sessionId, leaseEpoch}`).
9. THE Sprite_Schemas SHALL declare the messages `event`, `prompt.started` (`{id}`), `closing` (`{id, reason: "exit"|"detach"}`), `approval.ack` (`{approvalId, optionId, by}`), `clock.get` (`{}`) and `clock` (`{nowMono, freshAt}`).
10. THE Sprite_Schemas SHALL declare `bot.prompt` (`{id, promptId, room, sessionRole, sessionId?, text, resources?, replyTo?, kind}`, where `resources` is an array of JSON objects), `prompt.transferred` (`{id, promptId, target}`) and `approval.answer` (`{id, approvalId, epoch, optionId, by}`).
11. THE Sprite_Schemas SHALL declare `rewindPoint` (`{promptId, agentRef}`), `rewindPoints` (`{id}`), `rewindPointsListing` (`{id, points}`), `rewindPreview` (`{id, toPromptId, restore}`), `rewindPreviewListing` (`{id, files}`) and `rewind` (`{id, toPromptId, restore, filesHash?}`).
12. THE Sprite_Schemas SHALL declare `config` (`{approvalTimeoutMin: integer}`), `terminal.enter` (`{id, argv, env, guardPath?, run?, exitKeys}`, where `env` is a `Record<string,string>`), `terminal.exit` (`{id}`), `terminal.state` (`{state, sessionId, pid?}`), `terminal.return` (`{id, sessionId, leafRef, interrupted, turns (at most 50), newSessionId?}`) and `terminal.resume` (`{id, epoch}`).
13. THE Sprite_Schemas SHALL declare `bot.cancel` and `bot.shutdown` (`{id, reason, sessionId?}`), `ack` (`{id}`) and the G→N `ping` with the body `{}` (resolved decision 16).
14. THE Sprite_Schemas SHALL declare `sessionId?` on every per-session message (`event`, `prompt.*`, `approval.*`, `lock.*`, `bot.prompt`, `bot.cancel`, `prompt.transferred`, `rewind*`, `terminal.*`) and SHALL document that it is required in swap mode (DECISION-54).
15. THE Protocol_Package SHALL export the swap-mode rule as a refinement helper that rejects a per-session message without `sessionId` WHEN the connection is in swap mode.
16. THE Protocol_Package SHALL record each release's sprite fixtures under `fixtures/sprite-protocol/<version>/`, and SHALL provide a loader the CI test uses to replay the previous release's fixtures against the current schemas and the reverse.
17. THE Protocol_Package SHALL declare as out of scope that the sprite does not verify signatures, because the node has verified them before sending (§6.5).

### Requirement 20: Limits module

**User Story:** As a developer, I want every numeric limit in one module, so that checks and documentation never disagree.

Implements §20 row 1 design note (`limits.ts`), §6.2, §6.5, §6.6, §6.9.

#### Acceptance Criteria

1. THE Protocol_Package SHALL declare every numeric limit in `packages/protocol/src/limits.ts`.
2. THE Limits_Module SHALL export at least these constants: user message text 16,000 characters; envelope 256 KB; console frame 64 KB; attachment text 8 KB; Handoff_Packet attachments total 8 KB; `bot.tool.output` 32 KB; `bot.summary.text` 2 KB; `bot.terminalTurn.text` 32 KB; media chunk 32 KB decoded; media thumbnail 32 KB; voice audio 144 KB decoded; voice duration 30,000 ms; `voice.text.text` 2000 characters; media name 200 characters; media caption 500 characters; media per message 4; mentions per message 16; `requires` entries 8; watch quick message 140; watch voice transcript 280; roster quick messages 8; instructions 8000 characters; room name 1 to 48 characters; approval summary 120 characters; commands per bot 200; rewind points 100; rewind preview files 200; `terminal.return` turns 50; `fs.listing` dirs 200; file and diff content 256 KB; `approvalTimeoutMin` 1 to 240; `autopilotAsk` 50 entries of 200 characters; take-control duration 10 minutes; console-input age 60 seconds.
3. THE Schema_Source SHALL reference the Limits_Module for each limit and SHALL NOT repeat the number as a literal.
4. THE Limits_Module SHALL export each constant with a name that states the unit (for example `_BYTES`, `_CHARS`, `_MS`).
5. WHEN a limit is changed in the Limits_Module, THE Codegen SHALL regenerate the JSON Schema with the new value.
6. THE Protocol_Package SHALL declare configurable limits that §6.9 names without a value (`imageMaxMB`, `uploadMaxMB`, `maxSeatsPerBot`, `uploadKeepDays`) as Node_Configuration, and SHALL NOT export them from the Limits_Module (resolved decision 6).

### Requirement 21: Protocol-owned data (unsafe tokens, guard template, agents, cloud prompt)

**User Story:** As a security reviewer, I want the forbidden tokens and templates to live only in the protocol package, so that the SI-1 and SI-2 hooks can verify that no other product code spells them.

Implements SI-1 ("Allowed locations"), SI-2, §6.5 (`terminal.enter` data), §7.4.1 (Cloud_Prompt_Template), §20 row 1 design note (templates); P0-D6, P1-D11 (data side).

#### Acceptance Criteria

1. THE Protocol_Package SHALL declare the Unsafe_Tokens only in `packages/protocol/src/unsafe.ts`.
2. THE Unsafe_Tokens SHALL be built from (a) the SI-1 hook pattern list of §12.1 (`bypassPermissions`, `acceptEdits`, `dontAsk`, the Claude permission mode (SDK option and CLI flag) with a value outside the asking modes `manual` and `default`, the Claude prompts flag with a value other than `host`, `trust-all-tools`, `trust-tools=*`, `WRAITH_AUTO_APPROVE`) and (b) SI-2 (`--trust-all-tools`, `--trust-tools=*`, the Grok `permission_mode` values `always-approve` and `auto`, `yolo = true`, the Grok `approval_mode` setting with every value that skips asking, as listed in SI-2, and every Claude permission-mode value outside the asking modes, so that `auto` and unknown values are refused), and SHALL additionally include the Claude bypass flags `--dangerously-skip-permissions` and `--allow-dangerously-skip-permissions`.
3. THE Protocol_Package SHALL export the Unsafe_Tokens as typed constants and a matcher, so that validators import them and never spell the literals, and SHALL export the Claude asking-mode list (`manual`, `default`), the required prompts value (`host`), the lowest checked Claude Code version (`2.1.323`) and a predicate for the asking modes (DECISION-60, P-SI2-1).
4. THE Protocol_Package SHALL declare the Terminal_Guard_Template only in `packages/protocol/templates/claude-terminal-guard.json`.
5. THE Terminal_Guard_Template SHALL contain only: `permissions.defaultMode` set to `"default"`; the keys that disable auto mode and bypass mode (§8.1 states that the guard disables both but does not name the keys; the design phase takes the exact key names from the Claude settings reference confirmed by spike Q40); and `UserPromptSubmit`, `Stop` and `SessionEnd` hooks that call `/hook/terminal` (§8.1 and SI-1 Terminal-mode exception).
6. THE Terminal_Guard_Template SHALL contain no `hooks.PreToolUse` and no `hooks.PermissionRequest` entry (SI-2, C62).
7. THE Protocol_Package SHALL export the Terminal_Guard_Template as a typed value validated by a unit test.
8. THE Protocol_Package SHALL include a unit test that asserts the Terminal_Guard_Template has no `hooks.*` key other than `UserPromptSubmit`, `Stop` and `SessionEnd` (in particular no `PreToolUse` and no `PermissionRequest`), no `permissions.allow` and no `allowedTools` (§8.1; P0-D6, P9.16-D3).
9. THE Protocol_Package SHALL declare the Agent_Catalogue in `packages/protocol/src/agents.ts` with, per agent, `exit` (key sequence ending with `\r`), `neverSend` and `terminalCommands`.
10. THE Protocol_Package SHALL export the Cloud_Prompt_Template as `packages/protocol/templates/cloud-prompt.txt`, containing the marker `[wraith:<promptId>]`, the `Refs:` and `Context:` lines, and the delegation instruction text of §7.4.1.
11. THE Protocol_Package SHALL export a pure function that renders the Cloud_Prompt_Template from a Handoff_Packet and a bot list.
12. THE Protocol_Package SHALL contain no file outside `unsafe.ts` and the Terminal_Guard_Template that spells an Unsafe_Token literal, with the exception of test, fixture and spike paths excluded by the SI-1 hook definition.
13. THE Protocol_Package SHALL contain no logic that changes the set of tools allowed without asking, because SI-2 validation belongs to the node and sprite.

### Requirement 22: Runtime independence and single source of shapes

**User Story:** As a maintainer, I want the package to run unchanged on Node, Cloudflare Workers and browsers, and to be the only place where shapes are declared, so that apps never drift.

Implements §20 row 1 R3, §6 preamble ("Do not redeclare shapes in apps"), P0-D1.

#### Acceptance Criteria

1. THE Protocol_Package SHALL contain no import of a Runtime_Specific_Module.
2. THE Protocol_Package SHALL declare `zod` as its only runtime dependency.
3. WHEN the Protocol_Package is built, THE build SHALL fail IF any source file imports `node:*`, `cloudflare:*` or references `window`, `document` or `localStorage`.
4. THE Protocol_Package SHALL use no `Buffer`; base64 and byte-length handling SHALL use APIs available in Node, Workers and browsers.
5. THE Protocol_Package SHALL export its schemas, types, limits and catalogues from `packages/protocol/src/index.ts`.
6. THE Protocol_Package SHALL pass its test suite on Node and in the Workers test pool (`vitest-pool-workers`).
7. THE repository checks SHALL fail WHEN a Consumer_App declares a zod schema or type that duplicates a message body, supporting shape or error code of the Protocol_Package.
8. THE Consumer_Apps (relay, node, sprite, PWA, watch) SHALL import message shapes only from the Protocol_Package.
9. THE Protocol_Package SHALL provide a README listing the exported modules and the rule "do not redeclare shapes in apps".

### Requirement 23: Codegen of JSON Schema, types and fixtures

**User Story:** As a developer of non-TypeScript clients (such as the watch) and of the test suite, I want JSON Schema and fixtures generated from the zod schemas, so that every language checks the same contract.

Implements §20 row 1 R4 and design note ("zod is the source of truth, codegen JSON Schema + TS types"), §6.5 fixtures.

#### Acceptance Criteria

1. THE Protocol_Package SHALL treat the zod Schema_Source as the only source of truth for wire shapes.
2. WHEN Codegen runs, THE Codegen SHALL write one JSON Schema file per MessageType body, one for the Envelope, one for the Handoff_Packet, one for each Sprite_Schemas message and one for the Error_Catalogue.
3. WHEN Codegen runs, THE Codegen SHALL write the TypeScript types inferred from the Schema_Source to the generated output folder.
4. WHEN Codegen runs, THE Codegen SHALL write at least one valid Fixture per MessageType to the fixtures folder, and at least one invalid Fixture for each schema-level check named in this document.
5. WHEN Codegen is run twice without a change in the Schema_Source, THE Codegen SHALL produce byte-identical output.
6. WHEN a file under `packages/protocol/src` changes, THE Protocol_Codegen_Hook SHALL run Codegen and stage the regenerated JSON Schema and Fixtures in the same commit as the schema change.
7. THE Protocol_Codegen_Hook SHALL be stored in `.kiro/hooks` with the name `protocol-codegen`.
8. IF the generated output differs from the committed output in CI, THEN THE CI check SHALL fail with a message naming the stale files.
9. THE Protocol_Package SHALL NOT depend on the redactor, and THE Codegen SHALL NOT run or import the redactor pattern set; every Fixture SHALL use placeholder values only (no real keys, tokens or personal data) and SHALL pass the `secret-scan` hook in `.kiro/hooks` (SI-12). Redaction of outbound bodies (SI-8) belongs to the node.
10. THE Protocol_Package SHALL validate every valid Fixture against both the zod schema and the generated JSON Schema in a test, and every invalid Fixture SHALL fail both.
11. THE Codegen SHALL write JSON Schema for the `.strict()` Meta with `additionalProperties: false` and for the tolerant Sprite_Schemas without `additionalProperties: false`.

### Requirement 24: Test gates (round-trip, tamper data contract, CI)

**User Story:** As a maintainer, I want property-based and example tests that exercise the protocol package, so that P0 and P1 DoD items touching the package are provably met.

Implements §21.1 PBT #14 (zod part) and #6 (data part), P0-D1, P1-D6, P1-D10, P1-D13, P1-D15.

#### Acceptance Criteria

1. THE Protocol_Package SHALL include a property-based test that generates a valid Envelope for every MessageType, serializes it, parses it again, and asserts deep equality (PBT #14, zod part).
2. THE Protocol_Package test configuration SHALL define one named constant `PBT_MIN_RUNS = 500`, and every property-based test of this package SHALL run with at least `PBT_MIN_RUNS` runs (P1-D6).
3. THE Protocol_Package SHALL include a property-based test asserting that any change to `relay.*` leaves the Signature_Scope unchanged and any change to `meta` or `body` changes the Signature_Scope (PBT #6, data part).
4. THE Protocol_Package SHALL include a property-based test asserting that a Meta object with any additional field is rejected.
5. THE Protocol_Package SHALL include example tests proving `E_UNSUPPORTED_VERSION` and `E_PAYLOAD_TOO_LARGE` are returned before other validation (Requirement 5).
6. THE Protocol_Package SHALL include example tests for `approvalTimeoutMin` values 0, 1, 240 and 241 (P1-D15) and for the bot `name` rule (P1-D13).
7. THE Protocol_Package SHALL include the snapshot test of Requirement 18 criterion 12, asserting that every code in Appendix A exists in the Error_Catalogue and no other code exists.
8. THE Protocol_Package SHALL include a test asserting that BODY_Map, SIGNER_Map and the per-type metadata have identical key sets (Requirement 1).
9. THE Protocol_Package SHALL include a test that runs the import-boundary check of Requirement 22.
10. THE Protocol_Package tests SHALL run in `pnpm -r test` on CI for Linux and macOS and SHALL contain at least one non-empty suite (P0-D1).
11. THE `packages/fakes` consumers SHALL be able to build valid messages for every MessageType using the Protocol_Package fixtures or generators (P1-D10).

### Requirement 25: Traceability and spec boundaries

**User Story:** As a spec author for the other specs, I want this spec's boundaries and open points recorded, so that no behavior is implemented twice or left unowned.

Implements §20 (spec decomposition), §22.1 (human decisions are recorded, not guessed).

#### Acceptance Criteria

1. THE Protocol_Package SHALL implement only data contracts, validation of those contracts, and protocol-owned data, and SHALL leave behavior owned by S-crypto, S-relay-core, S-node-core, S-approval and S-sprite-acp to those specs.
2. WHEN an item in §6 is ambiguous or contradictory, THE design phase SHALL resolve it only after the corresponding open question below is answered by a human, and SHALL record the answer in `docs/DECISIONS-PENDING.md`.
3. THE SHALL NOT statements of SI-1, SI-2, SI-4, SI-9 and SI-12 as they apply to the Protocol_Package SHALL NOT be weakened, removed or edited by the agent loop (§22).

## Appendix A: Error code catalogue (§6.9)

The Error_Catalogue SHALL contain exactly these codes. Raised-by and HTTP are as listed in §6.9; the `meaning` and `clientAction` texts are copied from §6.9. "–" means no HTTP status is defined.

| Code | Raised by | HTTP | Meaning (short) |
|---|---|---|---|
| `E_BAD_SIGNATURE` | relay, node, pwa | 401 | Signature fails or `sig.by` does not match the WS |
| `E_SCHEMA_INVALID` | relay, node, sprite | 400 | Envelope or body fails the zod schema (other than version/size) |
| `E_REPLAY` | relay, node | 409 | Duplicate `meta.id` or nonce |
| `E_EXPIRED` | node | 410 | `ts` older than 7 days, or approval past `expiresAt` |
| `E_UNKNOWN_MEMBER` | relay | 401 | Member not in the roster |
| `E_REVOKED` | relay, node | 403 | Key has been revoked |
| `E_CAP_DENIED` | relay, node | 403 | Signer's cap is insufficient |
| `E_ROSTER_STALE` | node | 409 | Roster version lower than pinned |
| `E_BAD_SETUP_TOKEN` | relay | 403 | Wrong `POST /space` token |
| `E_SPACE_EXISTS` | relay | 409 | Space created twice |
| `E_TICKET_INVALID` | relay | 404 | Pairing ticket invalid |
| `E_TICKET_EXPIRED` | relay | 410 | Pairing ticket expired |
| `E_PAIR_HMAC_MISMATCH` | node, watch, device | – | HMAC mismatch at pairing |
| `E_APPROVAL_UNKNOWN` | sprite | 404 | `approvalId` not in the map |
| `E_ALREADY_RESOLVED` | sprite, relay | 409 | Already answered (including timeout) |
| `E_STALE_EPOCH` | sprite, node | 409 | Approval epoch does not match |
| `E_REQUEST_HASH_MISMATCH` | node | 400 | The user saw a different version of the request |
| `E_WORKSPACE_TAKEN` | node | 409 | Workspace already has a bot (`botId` included) |
| `E_PATH_OUTSIDE_WORKSPACE` | node | 403 | A bot asked to create a bot outside its own workspace |
| `E_SEAT_LIMIT` | node | 409 | Bot already has `maxSeatsPerBot` live seats |
| `E_OPTION_INVALID` | node | 400 | `optionId` not among the request's options |
| `E_SEAT_READ_ONLY` | node | 403 | Take control or typing into a group seat's pane |
| `E_NOT_MEMBER` | relay | 403 | `@mention` of a bot that is not a group member |
| `E_CLOUD_NO_GROUPS` | relay | 409 | Kiro Cloud bots cannot join groups |
| `E_SEATS_UNSUPPORTED` | node | 409 | Agent has `seats:"none"` |
| `E_TRANSFER_NOT_ALLOWED` | node | 409 | Second transfer, or mention/reply after a transfer, or transfer from `return`/`summary` |
| `E_NAME_TAKEN` | relay | 409 | Another bot already uses the name (`suggestion` included) |
| `E_PATH_NOT_DIR` | node | 400 | Path missing, not a folder, or is `/` or the home folder |
| `E_NOT_GIT` | node | 409 | Changes asked for a non-git workspace |
| `E_REWIND_UNSUPPORTED` | node | 409 | Agent cannot rewind, or checkpointing is off |
| `E_AGENT_UNSAFE` | node | 409 | Any SI-2 violation |
| `E_REWIND_POINT_GONE` | node, sprite | 410 | Agent no longer has that checkpoint |
| `E_BOT_BUSY` | node | 409 | Rewind asked while the bot is working |
| `E_REWIND_CHANGED` | node | 409 | Files to restore changed since the preview |
| `E_TERMINAL_UNSUPPORTED` | node | 400 | Terminal mode not available for this session or agent |
| `E_TERMINAL_BUSY` | node | 409 | Enter or exit refused while working, approval open, lock held, or no idle signal |
| `E_TERMINAL_ACTIVE` | node | 409 | Command aimed at a main session in Terminal mode |
| `E_TERMINAL_CLOSE_TIMEOUT` | sprite | 504 | Driver process still exists after the kill sequence |
| `E_TERMINAL_LAUNCH_FAILED` | sprite | 502 | TUI did not start within 15 s or exited early |
| `E_TERMINAL_SESSION_DIVERGED` | node | 409 | TUI session id differs after exit |
| `E_TERMINAL_SETTINGS_CHANGED` | node | 409 | TUI wrote rules, modes, hooks or files checked by SI-2 |
| `E_TERMINAL_RESUME_FAILED` | sprite | 500 | Driver could not resume the session after exit |
| `E_FILE_DENIED` | node | 403 | Path outside workspace, deny-listed, ignored or binary |
| `E_FILE_TOO_LARGE` | node | 413 | File or diff over 256 KB |
| `E_MEDIA_DENIED` | node | 403 | Share or upload outside workspace, deny-listed, or disallowed type |
| `E_MEDIA_TOO_LARGE` | node | 413 | Image, upload or upload data over its limit |
| `E_MEDIA_GONE` | node | 410 | Cached copy evicted and original moved, deleted or changed |
| `E_FOLDER_EXISTS` | node | 409 | `createFolder` for an existing folder |
| `E_PATH_OUTSIDE_ROOTS` | node | 403 | Path not under `workspaceRoots` after realpath |
| `E_LEASE_HELD` | relay | 409 | Session already has a lease holder |
| `E_LEASE_HELD_EXTERNAL` | sprite | – | "Active in another process" (Kiro lock) |
| `E_LEASE_LOST` | relay | – | Previous holder lost the lease (old `leaseEpoch`) |
| `E_NOT_LEASE_HOLDER` | relay | 403 | Node sent events for a bot it does not hold |
| `E_BOT_OFFLINE` | relay | 503 | Bot or node is not online |
| `E_BOT_NOT_FOUND` | relay | 404 | Bot does not exist |
| `E_TIER_UNSUPPORTED` | relay, node | 400 | Handoff to a T0, or Autopilot/Nudge for a bot that cannot use it |
| `E_CAPABILITY_MISSING` | relay | 400 | Receiver lacks `requires` (`suggested:[botId]` included) |
| `E_LOOP_DEPTH` | relay | 429 | Loop-guard depth limit |
| `E_LOOP_BUDGET` | relay | 429 | Loop-guard budget limit |
| `E_LOOP_RATE` | relay | 429 | Loop-guard rate limit |
| `E_ROOM_FROZEN` | relay | 423 | Room is frozen |
| `E_REPLY_TO_UNKNOWN` | relay | 400 | `replyTo` is not a prompt in progress |
| `E_QUOTA_EXCEEDED` | relay (CF) | 503 | Cloudflare quota exhausted |
| `E_QUEUE_DROPPED` | relay | – | Queue of a node offline over 7 days was dropped |
| `E_PAYLOAD_TOO_LARGE` | relay, node | 413 | Envelope over 256 KB, frame over 64 KB, or attachment over 8 KB |
| `E_RATE_LIMITED` | relay | 429 | Rate limit exceeded |
| `E_ORIGIN_DENIED` | relay | 403 | `Origin` not in the allowlist |
| `E_UNSUPPORTED_VERSION` | all sides | 400 | `v` is not 1 |
| `E_TAKECONTROL_REQUIRED` | node | 403 | Console input without a take-control session |
| `E_TAKECONTROL_EXPIRED` | node | 403 | Take-control session timed out |
| `E_INPUT_COUNTER_STALE` | node | 403 | Console input `n` not increasing |
| `E_PROMPT_PARTIAL` | node | – | Sprite crashed during a prompt |
| `E_AGENT_FAILED` | sprite | – | Agent crashed 3 times |
| `E_REDACTION_BLOCKED` | node | – | Body contains a secret the redactor cannot remove |
| `E_AGENT_UNAVAILABLE` | node | 400 | Agent not installed on that node |
| `E_HERDR_UNAVAILABLE` | node | 503 | Cannot connect to the herdr-core socket, or its protocol generation is not 1 |
| `E_SPRITE_DUPLICATE` | node | 409 | A second sprite connected for a session that already has one |
| `E_VOICE_UNAVAILABLE` | node, relay | 503 | No node with a working voice engine (`caps.voice`) |
| `E_VOICE_TOO_LONG` | relay, node | 413 | `durationMs` over 30 000 or audio over 144 KB |
| `E_VOICE_FAILED` | node | 500 | Voice engine crashed or returned nothing |
| `E_VOICE_TIMEOUT` | relay | 504 | No `voice.text` within 25 s |
| `E_RELAY_UNREACHABLE` | app | – | `GET <url>/healthz` failed or the answer is not a Wraith relay |
| `E_RELAY_SWITCH_LOCAL_ONLY` | app | – | Relay cards used where no local node is driven by this app |
| `E_INTERNAL` | all sides | 500 | Other |

## Resolved decisions

Decisions 1, 15 and 16 were made by the agent and are logged in `docs/DECISIONS-PENDING.md`. The others are owner answers of the 2026-11-10 review.

1. **Undefined shapes.** `Diff` and `Location` come from the ACP tool-call types; `Room`, `Bot`, `ApprovalView`, `LeaseView` and `BotSummary` come from §10; `tier` uses the `agents.json` values `t0`, `t1`, `t2`; `BotId` is a Ulid; `JWK` is an EC P-256 public JWK. Agent decision, logged. Affects Requirement 17 (and the `tier` and `signPub` fields in Requirements 9 and 16).
2. **SIGNER enum.** Keep the five values. `device` means signed by a roster key of kind device (Full, watch or viewer); the Verifier checks caps (§12.2). Affects Requirements 1 and 6, and the `owner or device` rows in Requirement 9.
3. **Error extra data.** An optional typed `data` object per code: `E_WORKSPACE_TAKEN {botId}`, `E_NAME_TAKEN {suggestion}`, `E_CAPABILITY_MISSING {suggested: Ulid[]}`. Affects Requirement 18.
4. **Device-addressed replies.** `bot.rewindPreviewListing` is not persisted, node-signed, with `meta.to` `device:<requester>`; every `device:<requester>` listing or response is node-signed and not stored. Exception kept from the §6.2 table: `crypt.listing` is `R→D` and unsigned. Affects Requirements 6, 13, 14 and 15.
5. **`media.ack`.** Unsigned in both directions (flow control only; integrity comes from the signed `sha256`). Affects Requirements 6 and 15.
6. **Configurable limits.** `imageMaxMB`, `uploadMaxMB`, `maxSeatsPerBot` and `uploadKeepDays` are node configuration, not in `limits.ts`. Affects Requirement 20.
7. **Missing `E_*` codes.** Resolved by listing every §6.9 code, including `E_VOICE_*` and `E_SPRITE_DUPLICATE`, in Appendix A. Affects Requirement 18 and Appendix A.
8. **`voice.transcribe` target.** `meta.to` is `relay`. Affects Requirement 15.
9. **`bot.tool`.** `completed` and `failed` are persisted and node-signed; `pending` and `in_progress` are not persisted and unsigned. The package exports `signerOf(type, body)` and `persistOf(type, body)`. Affects Requirements 1, 6 and 8.
10. **Cross-field checks.** Persist match and device-target-not-persisted are schema-level in this package. Affects Requirements 2 and 6.
11. **Size measure and order.** Size is the UTF-8 byte length of the raw frame measured before `JSON.parse`; the size check comes first, then the version check. Affects Requirement 5.
12. **Terminal guard hooks.** No conflict: `fake-tui` calls only the `UserPromptSubmit`, `Stop` and `SessionEnd` hooks; the guard follows SI-2. Affects Requirement 21.
13. **`relay.from`.** `RelayFields` gets `from?: MemberId`, for routing and denial-of-service limits only, never a security decision (SI-4). Affects Requirement 3.
14. **`meta.prompt.to`.** It is the target botId. Handoff Packet `from.bot` and `to.bot` are bot names (bot name rule); `from.botId` and `to.botId` are Ulid values. Affects Requirement 11.
15. **Handoff Packet optionality.** `replyTo` is nullable; `root`, `refs` and `context` are optional; `attachments` defaults to `[]`. Agent decision, logged. Affects Requirement 11.
16. **Sprite shapes.** The sprite `ping` body is `{}`; `resources` is an array of JSON objects; `env` is `Record<string,string>`. Agent decision, logged. Affects Requirement 19.
17. **`user.message.via`.** `via?: "voice"` is part of the `user.message` body, as drafted. Affects Requirement 8.
18. **Unknown message types.** An Envelope with an unknown `meta.type` is rejected with `E_SCHEMA_INVALID`; only sprite-level messages of an unknown type are ignorable. Affects Requirements 2 and 19.
19. **`crypt.listing` signer.** `crypt.listing` stays direction `R→D` and unsigned (signer `none`), because the relay answers from its crypt-index and holds no signing key. Owner answer of the 2026-11-10 review. Affects Requirements 6 and 14.

## Open questions

These points are not answered by `docs/architecture.md` §6 or §20 and need a human decision.

1. **Terminal guard key names (§8.1).** §8.1 says the guard disables auto mode and bypass mode but does not name the settings keys. Requirement 21 criterion 5 leaves the exact key names to the design phase (spike Q40).

