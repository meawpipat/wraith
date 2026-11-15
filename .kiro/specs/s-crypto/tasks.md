# Implementation Plan: S-crypto

## Overview

This plan builds `packages/crypto` (`@wraith/crypto`) in TypeScript, following the module layout and dependency rules of design.md: `errors.ts`, `guard.ts`, `webcrypto.ts`, `bytes.ts` and `p256.ts` import nothing from the rest of the package; `jcs.ts` imports `utf8.ts` and `errors.ts` only and never touches WebCrypto; only `keys.ts`, `scope-bytes.ts`, `sign.ts`, `request-hash.ts` and `errors.ts` import `@wraith/protocol`, and only through the bare specifier; every exported verifier is one `return failClosed(...)` expression. Requirement ids are R-numbers and criteria of requirements.md; "Design" names a section or Correctness Property of design.md. Neither document is edited by this plan.

**PREREQUISITE (outside this task list, separate S-protocol commit):** before any S-crypto coding, the JWK-first S-protocol commit must exist (R1.7, design choice 13). It is executed under spec `s-protocol`, not as an S-crypto checkbox task. It contains only (a) the JWK schema part of S-protocol task 8.1 (a schema of exactly `kty`, `crv`, `x`, `y` and nothing else; `Tier` and `BotId` stay in S-protocol task 8.1 (P1), as does the rest of 8.1) and (b) the `"@wraith/source"` export condition on `@wraith/protocol`'s `"."`, `"./testing"` and `"./testing/arbitraries"` exports, pointing at `src/*.ts` and listed before the dist targets. Task 1.1 verifies it and stops if it is missing. No S-crypto task declares a local JWK substitute.

Phasing: P0 groups (1 to 8) deliver what P0-D2 and P0-D3 need: the package skeleton with the `node` Vitest project, the `CRYPTO_PBT_RUNS = 1000` helper and its scan, errors, guard, WebCrypto access, bytes, Base64url, UTF-8, SHA-256, random, JCS, key handling (needed by sign and verify), scope bytes, sign, verify, `requestHash`, the Known_Answer_Vectors, the boundary check, the Workers project with `@cloudflare/vitest-plugin` and the Workers run of the JCS byte-equality suite, and the PHASE-STATUS evidence rows. Properties 1 to 17 are all P0: Properties 1 and 2 feed the P0-D3 path, 3 to 5 are PBT #14 (JCS) and P0-D2, 6 to 12 and 14 are P0-D3 and PBT #6, and 13, 15, 16 and 17 test the failure model and the key functions that sign and verify depend on and are cheap to run next to them. P1 groups (10 to 12) deliver the pairing HMAC (R11), the `ws-auth` and `WraithSig` payloads (R10), Properties 18 to 21, the extension of Properties 12 and 13 to the P1 verifiers, the browser run of the vectors (R13.16) and the final README. Nothing in R10 or R11 is needed by P0-D2 or P0-D3, so they are P1. Each group title carries its phase.

Every task or group has a `DoD:` line mapping it to the P0/P1 DoD ids of docs/architecture.md §18.1 and §18.2 that it really supports. P0-D1 is always "supports" (the CI workflow on Linux and macOS is S-ops-packaging); P1-D6 is "supports" (S-crypto owns the crypto parts of PBT #6 and #14 only); reuse of the Workers project by S-protocol task 19.1 is stated as a note and S-protocol tasks are not edited. A DoD coverage table at the end lists what is outside this spec.

Conventions:
- Every Correctness Property of design.md is a required property sub-task (no `*`), cites its property number and requirement ids, and runs through the `pbt(...)` helper of `test/config.ts` using the local constant `CRYPTO_PBT_RUNS = 1000`. `PBT_MIN_RUNS` of S-protocol is never imported.
- Optional (`*`) is used only for extra unit tests. The tests that give direct evidence stay required: the JCS Known_Answer_Vectors on `node` and `workers` (P0-D2), the sign then verify round trip and the mutate-any-byte, value and signature properties at 1,000 runs (P0-D3), the hostile-input table (R3.8), and every source-scan test that enforces a design rule (single `failClosed` verifier, no deep protocol import, forbidden constructs in `src`, every `fc.assert` through the helper, no numeric run-count literals).
- Test files (`*.test.ts`) export nothing (Biome `noExportsInTest`); shared test code lives in `test/support/*.ts` and `test/config.ts`.
- Tests run under both Vitest projects where portable. Files named `*.node.test.ts` run in the `node` project only and may use `node:fs`. The `workers` project must not import `node:` modules, so vectors are loaded as JSON imports with an import attribute.
- Each shared file has one owning task per group: `src/index.ts` (the export task of each group), `package.json` (1.2, 7.1, 8.1, 12.2), `vitest.config.ts` (1.4, 2.2, 8.2, 8.3, 12.2), `tsconfig.scripts.json` (1.3, 2.2), the vectors file and `test/support/vectors.ts` (one task per group: 2.6, 3.5, 4.4, 5.5, 10.3, 11.3), `docs/PHASE-STATUS.md` (5.22, 8.5). Tasks that run in the same wave never write the same file.
- Each group lists the files it owns (for the per-group commit by the orchestrating loop) and ends with a verification sub-task that runs `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm --filter @wraith/crypto check` and `pnpm exec biome check packages/crypto fixtures/crypto docs` style checks for the package (the exact Biome invocation follows the repo scripts), all clean.
- Dependencies are pinned at install time with exact versions, no ranges, and the versions are recorded: `fast-check` 4.10.2, `vitest` 5.0.5 and `@types/node` at the versions already used by the root and by protocol, `@cloudflare/vitest-plugin` and whatever its README requires as peer or dev dependencies (for example `wrangler`, `workerd`), pinned exactly when installed. Installing these from the npm registry is allowed; nothing else needs network, a human, money or publishing.
- Key material, secrets and signatures are never spelled in this file or in committed tests; tasks use placeholders and patterned artificial bytes. The vectors file holds no private key.
- Task-time facts the design marks as unverified (WebCrypto behaviours on Node and Workers, the `@wraith/source` resolution under `tsc` and Vite, the JSON import attribute under both projects, the relative import of the protocol script, the cost of 1,000-run properties on Workers) are verified by a named task step. None is presumed to work.

## Tasks

### Prerequisite (S-protocol work, separate commit)

Not a checkbox task of this spec. Under spec `s-protocol`, before group 1 of this plan starts: (a) the exact-four-member `JWK` schema (`kty`, `crv`, `x`, `y`; a private member is rejected), exported from `@wraith/protocol`; the prerequisite is the JWK schema only, and `Tier` and `BotId` stay in S-protocol task 8.1 (P1); (b) the `"@wraith/source"` condition on the exports `"."` (to `./src/index.ts`), `"./testing"` (to `./src/testing/builders.ts`) and `"./testing/arbitraries"` (to `./src/testing/arbitraries.ts`), listed before the `types` and `default` dist targets. The rest of S-protocol task 8.1 stays P1. This plan does not edit S-protocol files or tasks.

- [x] 1. Package skeleton, prerequisite check and test runner (P0)
  - DoD: P0-D1 (supports: S-ops-packaging owns the CI workflow; this group makes the `crypto` suite exist and run), P0-D3 (supports: defines `CRYPTO_PBT_RUNS`), P1-D6 (supports). Requirements: R1.1, R1.4, R1.5, R1.6, R1.7, R13.1, R13.2, R13.3. Design: "What exists today", "Module layout", "Build, resolution and ordering", "Test configuration".
  - Files owned: `packages/crypto/package.json`, `packages/crypto/tsconfig.json`, `packages/crypto/tsconfig.scripts.json`, `packages/crypto/vitest.config.ts`, `packages/crypto/README.md`, `packages/crypto/test/config.ts`, `packages/crypto/test/config.test.ts`, `packages/crypto/test/pbt-helper-use.node.test.ts`, `pnpm-lock.yaml`.
  - [x] 1.1 Verify the S-protocol prerequisite (precondition step, no file changes)
    - Grep `packages/protocol/package.json` for `"@wraith/source"` on the `.`, `./testing` and `./testing/arbitraries` exports, check that each is listed before the `types` and `default` targets, and check that `packages/protocol/src` exports a `JWK` schema of exactly `kty`, `crv`, `x`, `y`; run `pnpm typecheck` and `pnpm -r test` to confirm the S-protocol commit is clean
    - If any item is missing, STOP and report to the owner. Do not add the condition or a JWK schema from S-crypto, and do not declare a local substitute (R1.7)
    - _Requirements: R1.7_
    - Design: "What exists today" (JWK not exported), "Build, resolution and ordering"
    - DoD: P0-D1 (supports)
  - [x] 1.2 Configure `package.json`, `tsconfig.json` and the README; install pinned dev dependencies
    - `package.json`: `exports` with one `"."` entry (`types` and `default` into `dist`, no `@wraith/source` condition), scripts `build` (`tsc -p tsconfig.json`; the boundary script is added in 7.1), `test` (`vitest run`), `check` (`tsc -p tsconfig.scripts.json --noEmit`; the boundary script is added in 7.1); `dependencies`: `"@wraith/protocol": "workspace:*"` only; `devDependencies`: `fast-check`, `vitest`, `@types/node` at the exact versions the root and protocol use
    - `tsconfig.json`: extends the base, `lib: ["ES2022"]`, `types: []`, `rootDir: "src"`, `outDir: "dist"`, `include: ["src"]`, `references: [{ "path": "../protocol" }]`
    - `README.md`: keep the paragraph and add the rule that the package depends on `@wraith/protocol` and never stores keys; the export list is finished in 12.3
    - Run `pnpm install` so the workspace link and lockfile are updated; record the installed versions
    - _Requirements: R1.1, R1.4, R1.5, R1.6, R2.3_
    - Design: "Module layout", "Build, resolution and ordering" (dependencies), Data Models
    - DoD: P0-D1 (supports)
  - [x] 1.3 Create `tsconfig.scripts.json` (the project behind `check`)
    - Node types; covers `src`, `scripts`, `test`, `vitest.config.ts` and the vectors JSON file (`../../fixtures/crypto/known-answers.json`) in `include`; `noEmit`, no `rootDir`; `customConditions: ["@wraith/source"]` with `module` set to `NodeNext`; JSON import attributes allowed
    - The verification of this setup against real protocol imports is task 2.2
    - _Requirements: R1.1_
    - Design: "Module layout" (tsconfig.scripts.json), "Build, resolution and ordering"
    - DoD: P0-D1 (supports)
  - [x] 1.4 Create the `node` Vitest project, `test/config.ts` and its test
    - `vitest.config.ts` with one `node` project that runs every `test/**/*.test.ts`, sets `resolve.conditions` to include `"@wraith/source"` and follows the shape of `packages/protocol/vitest.config.ts`; the `workers` project is added in 8.2
    - `test/config.ts` exports `CRYPTO_PBT_RUNS = 1000` and `pbt(...)`, which wraps `fc.assert`, defaults `numRuns` to the constant and refuses a lower value; it does not import `PBT_MIN_RUNS` or anything from the protocol test folder
    - `test/config.test.ts`: asserts the constant is 1000, that `pbt` refuses 999 and runs at least 1000 by default (makes the suite non-empty from the start)
    - _Requirements: R13.1, R13.2, R13.3, R12.2_
    - Design: "Test configuration (`test/config.ts`)", Testing Strategy (conventions)
    - DoD: P0-D3 (supports: defines the 1,000-run constant), P0-D1 (supports), P1-D6 (supports)
  - [x] 1.5 Write the scan test that every `fc.assert` goes through `pbt(...)` and that no run count is a literal
    - `test/pbt-helper-use.node.test.ts`: strips comments, then fails on a direct `fc.assert(`, a named `assert` import from `fast-check`, and any `numRuns:` followed by a numeric literal (a literal is not allowed at all; only the identifier `CRYPTO_PBT_RUNS`); scans `test/**` except `test/config.ts`; has a self-check on sample sources that each offending form is reported
    - Required: it enforces a design rule (R13.3); the aliased-call blind spot is stated in a comment
    - _Requirements: R13.3_
    - Design: Testing Strategy (conventions)
    - DoD: P0-D3 (supports), P1-D6 (supports)
  - [x] 1.6 Run the group verification (group 1)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm --filter @wraith/crypto check` and the Biome check for `packages/crypto`; all clean
    - List the files this group changed for the commit
    - _Requirements: R1.5_
    - Design: "Build, resolution and ordering"
    - DoD: P0-D1 (supports)

- [x] 2. Errors, guard, WebCrypto access and encoding helpers (P0)
  - DoD: P0-D1 (supports), P0-D3 (supports: the failure model and helpers that sign and verify build on), P1-D6 (supports). Requirements: R2, R3.4 to R3.6, R4, R13.11 (Base64url part). Design: "Types shared by the package", "WebCrypto access", "Failure guard", "Encoding helpers", Properties 1 and 2.
  - Files owned: `packages/crypto/src/{errors,guard,webcrypto,bytes,base64url,utf8,sha256,random,index}.ts`, `packages/crypto/tsconfig.scripts.json` and `packages/crypto/vitest.config.ts` (only if 2.2 needs the fallback), `fixtures/crypto/known-answers.json`, `packages/crypto/test/support/{hex,vectors}.ts`, `packages/crypto/test/{base64url,utf8,vectors-encoding,sha256-random,guard-errors}.test.ts`.
  - [x] 2.1 Create `errors.ts` and `guard.ts`
    - `ProgrammerError` (message is exactly `"wraith-crypto: " + reason`, no `cause`), `ProgrammerReason`, `FailReason`, `CryptoFailure` and `CryptoResult` typed through the protocol `ErrorCode` (`Extract<ErrorCode, "E_SCHEMA_INVALID">`); `failClosed(run)` (`try { return (await run()) === true } catch { return false }`, binding nothing and logging nothing), `isRecord`, `isPlainRecord`
    - `errors.ts` imports types from `@wraith/protocol` only; `guard.ts` imports nothing
    - _Requirements: R1.2, R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R2.9_
    - Design: "Types shared by the package", "Failure guard", "Data Models" (Failure and error data)
    - DoD: P0-D3 (supports)
  - [x] 2.2 Verify `@wraith/source` resolution for `tsc` and Vitest and apply the design fallback if needed
    - Using a temporary probe (a test file and a type import of `@wraith/protocol`, `@wraith/protocol/testing` and `@wraith/protocol/testing/arbitraries`, deleted afterwards), verify on a fresh state with protocol `dist` removed or renamed: (1) `check` type-checks crypto with `customConditions` and `noEmit` (protocol sources under crypto's program, `.js` specifiers inside protocol sources, JSON imports with `resolveJsonModule`); (2) Vitest resolves the three entries from source in the `node` project; (3) `build` (`tsc -p tsconfig.json`, no condition) still produces the same output from protocol's declarations after `pnpm -r build`
    - If (1) fails, apply the design's fallback inside the same decision: only `tsconfig.scripts.json` keeps the condition with `composite: false`, `noEmit: true`, no `rootDir` and, if `tsc` asks for it, `allowImportingTsExtensions`, leaving `tsconfig.json` unchanged; if even that fails, `check` resolves protocol through `dist` and the README states that `pnpm -r build` comes first. Record which case applied (the PHASE-STATUS or DECISIONS-PENDING note is written by 8.5 and 8.6)
    - If Vitest does not resolve from source, STOP and report; do not switch to `dist` on your own initiative
    - Restore protocol `dist`, delete the probe files
    - _Requirements: R1.1, R13.13_
    - Design: "Build, resolution and ordering" (Constraint to verify at task time), Design choice 13
    - DoD: P0-D1 (supports), P0-D3 (supports: tests reach the protocol arbitraries through source)
  - [x] 2.3 Create `webcrypto.ts` and `bytes.ts`
    - `webcrypto.ts`: local structural types (`CryptoKeyHandle`, `KeyPair`, the `SubtleCrypto` subset, a `TextEncoder` declaration); `getSubtle()` and `getRandomValuesFn()` read `globalThis.crypto` on each call and throw `ProgrammerError("webcrypto_unavailable")` when missing; names no Node, Workers or browser API
    - `bytes.ts`: `concatBytes`, `equalBytesFixed` (fixed-length XOR accumulation, no early exit), `u64be` (safe non-negative integer split into two 32-bit halves; `ProgrammerError("invalid_argument")` otherwise); imports nothing from the package
    - _Requirements: R2.1, R2.2, R2.3, R2.8, R3.3, R9.8, R11.8_
    - Design: "WebCrypto access", Module layout (`bytes.ts`)
    - DoD: P0-D1 (supports)
  - [x] 2.4 Create `base64url.ts` and `utf8.ts`
    - Hand-written strict Base64url: 64-entry alphabet and 128-entry reverse table; `encodeBase64Url` writes no padding; `decodeBase64Url(input: unknown)` returns `CryptoResult<Uint8Array>` and rejects non-strings, any character outside the alphabet (including `=`, `+`, `/`, whitespace, code units above 127), a length with remainder 1 modulo 4, and non-zero unused trailing bits; never echoes the input
    - `utf8Encode` rejects a lone surrogate with `ProgrammerError("lone_surrogate")` before calling the platform `TextEncoder`; `tryUtf8Encode` returns `null` instead of throwing (internal use by verification paths)
    - _Requirements: R4.1, R4.2, R4.3, R4.4, R4.6, R2.3_
    - Design: "Encoding helpers (`base64url.ts`, `utf8.ts`, `sha256.ts`, `random.ts`)"
    - DoD: P0-D3 (supports)
  - [x] 2.5 Create `sha256.ts` and `random.ts`
    - `sha256(bytes)` (32 bytes) and `sha256Base64Url(bytes)` through `crypto.subtle.digest`; a WebCrypto rejection becomes `ProgrammerError("webcrypto_failed")` with a fixed message
    - `randomBytes(n)` through `getRandomValues`, integer 0 to 65536 else `ProgrammerError("invalid_argument")`; no `Math.random`
    - _Requirements: R4.5, R4.7, R2.1_
    - Design: "Encoding helpers"
    - DoD: P0-D3 (supports)
  - [x] 2.6 Create the vectors file with the `base64url` and `sha256` sections and the vectors support modules
    - `fixtures/crypto/known-answers.json`: `base64url` (empty, 1, 2, 3 byte inputs, bytes that map to `-` and `_`, and invalid strings that must be rejected) and `sha256` (empty input and `abc`); every byte string is lower-case hex text; each vector has a `source` field (published value or "independent computation, see task notes")
    - `test/support/hex.ts` (hex text to bytes and back) and `test/support/vectors.ts` (loads the file with `import vectors from "../../../../fixtures/crypto/known-answers.json" with { type: "json" }` adjusted to the real relative path; hand-written shape guard, no zod; no `node:` import)
    - Expected values are published or computed outside the package under test, never pasted from its output
    - _Requirements: R4.8, R6.15, R13.15_
    - Design: "Known_Answer_Vectors", "Sharing the Known_Answer_Vectors between projects"
    - DoD: P0-D2 (supports: the vectors file is the portable contract), P0-D1 (supports)
  - [x] 2.7 Export the foundations from `src/index.ts`
    - Re-export `errors`, `guard` (`failClosed` is internal unless the design lists it; export only what design.md names public), `base64url`, `utf8`, `sha256`, `random` and the shared types; re-exports only, nothing from `@wraith/protocol`
    - This task owns the `index.ts` edit for group 2
    - _Requirements: R1.5, R1.2, R1.3_
    - Design: "Module layout" (`index.ts`)
    - DoD: P0-D1 (supports)
  - [x] 2.8 Write known-answer tests for Base64url and SHA-256
    - `test/vectors-encoding.test.ts`: every `base64url` and `sha256` vector, including the rejected spellings; runs in both projects
    - _Requirements: R4.8_
    - Design: "Unit and example tests" (known-answer tests)
    - DoD: P0-D3 (supports), P0-D2 (supports)
  - [x] 2.9 Write property test for Base64url
    - **Property 1: Base64url round trip and canonical form**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 13.11**
    - Tag `Feature: s-crypto, Property 1: Base64url round trip and canonical form`; runs with `CRYPTO_PBT_RUNS` through `pbt(...)`
    - DoD: P0-D3 (supports), P1-D6 (supports)
  - [x] 2.10 Write property test for the UTF-8 encoder
    - **Property 2: UTF-8 encoder rejects what has no UTF-8 form**
    - **Validates: Requirements 4.6**
    - Tag `Feature: s-crypto, Property 2: UTF-8 encoder rejects what has no UTF-8 form`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P0-D3 (supports), P1-D6 (supports)
  - [x]* 2.11 Write example tests for SHA-256, `randomBytes` and WebCrypto access
    - Digest length and Base64url form, `randomBytes` length and argument errors, two calls differ, missing `crypto.subtle` gives `ProgrammerError("webcrypto_unavailable")` (the global-removing case in a `.node.test.ts` file, restored in `afterEach`)
    - _Requirements: R4.5, R4.7, R3.3_
    - Design: "WebCrypto access", Testing Strategy (unit tests)
    - DoD: P0-D3 (supports)
  - [x]* 2.12 Write unit tests for `failClosed` and `ProgrammerError`
    - `failClosed` turns a sync throw, a rejection and a non-`true` result into `false`; `ProgrammerError` message is the fixed prefix plus the reason and carries no `cause`
    - _Requirements: R3.1, R3.2, R3.3, R3.6_
    - Design: "Failure guard"
    - DoD: P0-D3 (supports)
  - [x] 2.13 Run the group verification (group 2)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm --filter @wraith/crypto check` and the Biome check for `packages/crypto`; all clean; list the files for the commit
    - _Requirements: R2.2_
    - Design: "Build, resolution and ordering"
    - DoD: P0-D1 (supports)

- [x] 3. JCS (RFC 8785) and the P0-D2 known-answer suite (P0)
  - DoD: P0-D2 (JCS Known_Answer_Vectors and Properties 3 and 4; the Workers run is in group 8), PBT #14 JCS part (P1-D6 supports), P0-D1 (supports). Requirements: R6, R12.1, R12.9, R13.12. Design: "JCS (`jcs.ts`)", "JCS conformance (P0-D2, PBT #14) and what it proves", Properties 3 to 5.
  - Files owned: `packages/crypto/src/jcs.ts`, `packages/crypto/src/index.ts`, `fixtures/crypto/known-answers.json`, `packages/crypto/test/support/{vectors,jcs-reference,json-arbitrary,hostile}.ts`, `packages/crypto/test/{jcs-vectors,jcs-identical,jcs-roundtrip,jcs-rejects,jcs-examples}.test.ts`.
  - [x] 3.1 Create `jcs.ts`
    - `canonicalize(value): string` and `canonicalizeBytes(value): Uint8Array`; iterative with an explicit stack (no recursion, no depth limit); cycle detection through the set of objects on the current path; own-keys traversal through `Reflect.ownKeys` and property descriptors (accessor, non-enumerable and symbol keys are `non_json_value`, getters never invoked, each property read once); arrays must have the array prototype, no holes and no extra own keys; objects must be plain (prototype `Object.prototype` or `null`); own `__proto__` is an ordinary member
    - Keys sorted on a copy with `<` and `>` (UTF-16 code units, no `localeCompare`); numbers via `String(n)` (`-0` gives `0`), `NaN` and infinities `non_finite_number`, `bigint` `bigint_value`; strings escaped in one pass (seven shorthand escapes, lower-case `\u00xx` below U+0020, everything else verbatim), lone surrogates in strings or names `lone_surrogate`; output converted with `utf8Encode`
    - Imports `utf8.ts` and `errors.ts` only; no WebCrypto, no dependency
    - _Requirements: R6.1 to R6.12, R6.16, R2.3_
    - Design: "JCS (`jcs.ts`)"
    - DoD: P0-D2, P0-D3 (supports)
  - [x] 3.2 Create the independent JCS reference `test/support/jcs-reference.ts`
    - Written with a different method on purpose: recursion over `Object.entries` with a sort, escaping by iterating code points with a lookup table, number text built by searching for the shortest `toPrecision(k)` that round-trips and applying the ECMAScript layout rules for exponent and decimal point; plus the `JSON.stringify` oracle for the equal subset (rebuild object members in UTF-16 sorted order, then `JSON.stringify`)
    - Test-side only; imports nothing from `src`; no `node:` import
    - _Requirements: R12.1, R13.12_
    - Design: "JCS conformance" (layers 2 and 3)
    - DoD: P0-D2 (supports), P1-D6 (supports)
  - [x] 3.3 Create the JSON value arbitrary `test/support/json-arbitrary.ts`
    - Biased towards the edge cases of Property 3: key alphabet mixing U+0000 to U+001F, U+D7FF, U+E000, U+FF5E and astral characters; doubles from `fc.double` including `-0`, subnormals, values around `1e21` and `1e-7`, integers beyond 2^53; strings filtered to well-formed; a variant that permutes object insertion order
    - _Requirements: R13.12, R6.3, R6.4, R6.5_
    - Design: Testing Strategy (Generators, JSON values)
    - DoD: P0-D2 (supports), P1-D6 (supports)
  - [x] 3.4 Create the hostile-value generators `test/support/hostile.ts`
    - Objects with throwing getters, proxies whose traps throw, cyclic structures, class instances, functions, symbols, sparse arrays, very deep nesting, plus the Non_JSON_Value substitution helper for Property 5; shared by Properties 5 and 12; portable (no `node:` import)
    - _Requirements: R3.8, R6.10, R13.10_
    - Design: Testing Strategy (Generators), Properties 5 and 12
    - DoD: P0-D3 (supports)
  - [x] 3.5 Add the `jcs` section to the vectors file and extend the vectors guard
    - RFC 8785 Appendix B number table keyed by IEEE-754 bit pattern with the published expected text, the section 3.2.3 sorting example, a nested object whose UTF-16 order differs from code point order (U+FF5E against an astral character), U+2028 and U+2029, control characters, `__proto__` as a member name given as JSON text, empty object, empty array, and a deep nested array given as a depth parameter that the test builds; expected output is hex; read the RFC text at task time and cite the section in each `source`
    - This task owns the edits of the vectors file and `test/support/vectors.ts` for group 3
    - _Requirements: R6.14, R6.15, R12.1_
    - Design: "Known_Answer_Vectors" (`jcs`)
    - DoD: P0-D2
  - [x] 3.6 Export `jcs` from `src/index.ts`
    - Add `canonicalize` and `canonicalizeBytes` to the public exports
    - This task owns the `index.ts` edit for group 3
    - _Requirements: R1.5, R6.1_
    - Design: "Module layout" (`index.ts`)
    - DoD: P0-D1 (supports)
  - [x] 3.7 Write the JCS known-answer tests (P0-D2 evidence)
    - `test/jcs-vectors.test.ts`: every `jcs` vector must produce the expected hex bytes through `canonicalizeBytes`; portable, so it runs in `node` and, after group 8, in `workers`; must not be a `.node.test.ts` file
    - Required: this is the direct P0-D2 evidence
    - _Requirements: R6.14, R12.1, R12.2, R12.9_
    - Design: "JCS conformance" (layer 1)
    - DoD: P0-D2
  - [x] 3.8 Write property test for JCS identical bytes
    - **Property 3: JCS output is identical to the independent reference**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.8, 6.11, 6.12, 12.1, 13.12**
    - Compares with the `JSON.stringify` oracle and with `jcs-reference.ts`, checks no whitespace, order independence, and that a deep-frozen copy gives the same output
    - Tag `Feature: s-crypto, Property 3: JCS output is identical to the independent reference`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P0-D2, P1-D6 (supports; PBT #14)
  - [x] 3.9 Write property test for JCS round trip and idempotence
    - **Property 4: JCS parse round trip and idempotence**
    - **Validates: Requirements 6.1, 6.13, 13.12**
    - Tag `Feature: s-crypto, Property 4: JCS parse round trip and idempotence`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P0-D2, P1-D6 (supports; PBT #14)
  - [x] 3.10 Write property test for JCS rejection of Non_JSON_Values
    - **Property 5: JCS rejects every Non_JSON_Value at any depth**
    - **Validates: Requirements 3.5, 6.6, 6.7, 6.9, 6.10, 7.6, 9.7**
    - This task covers the canonicalizer clauses; the `sign` and `requestHash` clauses (7.6, 9.7) are added in 5.20
    - Tag `Feature: s-crypto, Property 5: JCS rejects every Non_JSON_Value at any depth`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P0-D2 (supports), P0-D3 (supports), P1-D6 (supports)
  - [x]* 3.11 Write example tests for the canonicalizer
    - Escapes (`\b \t \n \f \r \" \\`, `\u001f`, U+007F verbatim, `/` unescaped), `__proto__` as an own member, a shared acyclic object (DAG) versus a cycle, 100,000 levels of nested arrays without a stack error, input not mutated, accessor and symbol keys rejected, `1e21`, `1.0`, `0.000001`, `1e-7`
    - _Requirements: R6.3 to R6.12, R6.14_
    - Design: "JCS (`jcs.ts`)"
    - DoD: P0-D2 (supports)
  - [x] 3.12 Run the group verification (group 3)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm --filter @wraith/crypto check` and the Biome check for `packages/crypto`; all clean; list the files for the commit
    - _Requirements: R12.10_
    - Design: "Build, resolution and ordering"
    - DoD: P0-D1 (supports)

- [x] 4. P-256 helpers and key handling (P0)
  - DoD: P0-D3 (supports: sign and verify need generation, import and export), P1-D6 (supports). Requirements: R5, R3.4. Design: "P-256 point helpers (`p256.ts`) and keys (`keys.ts`)", Properties 15 to 17.
  - Files owned: `packages/crypto/src/{p256,keys,index}.ts`, `fixtures/crypto/known-answers.json`, `packages/crypto/test/support/{vectors,keys}.ts`, `packages/crypto/test/{keys-flags,keys-vectors,keys-roundtrip,keys-import,keys-compressed}.test.ts`.
  - [x] 4.1 Create `p256.ts`
    - `isOnCurve` and `decompress` with `BigInt`, public data only (coordinates below the field prime, curve equation, square root by one modular exponentiation, parity from the prefix byte); curve constants from FIPS 186-4 / SEC 2 read at task time and verified by task 4.7, not copied from memory
    - Imports `bytes.ts` only; no private scalar, secret or signature input ever enters this module
    - _Requirements: R5.7, R5.13_
    - Design: "P-256 point helpers (`p256.ts`) and keys (`keys.ts`)" (On-curve check)
    - DoD: P0-D3 (supports)
  - [x] 4.2 Create `keys.ts`
    - `generateKeyPair({extractablePrivate})` (default false; usages `sign` and `verify`), `exportPublicJwk` (exactly `kty`, `crv`, `x`, `y`; `wrong_key_type` for a non-public key), `exportPrivateJwk` (adds `d`; `key_not_extractable` before calling WebCrypto), `importPublicKey` and `importPrivateKey` (normalize, validate, import: plain record, `d` rules, only `kty`, `crv`, `x`, `y` plus ignored `use`, `key_ops`, `ext`, `alg`, any other member rejected, run the protocol `JWK` schema on the normalized four-member object, strict 32-byte coordinates, on-curve check, `importKey("jwk")` with only normalized members), `publicJwkOf` (drops `d`), `publicKeyToCompressed`, `publicKeyFromCompressed`, `keyFingerprint` (SHA-256 of the 33-byte compressed point), all failures `E_SCHEMA_INVALID` with a `FailReason`
    - `PrivateJwk` is a local type with a hand-written structural check, no zod; nothing is written to storage or logged
    - _Requirements: R5.1 to R5.14, R3.4, R1.2, R1.3_
    - Design: "P-256 point helpers (`p256.ts`) and keys (`keys.ts`)"
    - DoD: P0-D3 (supports)
  - [x] 4.3 Create the key pool support `test/support/keys.ts`
    - A pool of key pairs generated once per file, a fresh-pair helper, and the defect injectors for Property 16 (a `d` member, wrong `kty`, wrong `crv`, wrong-length coordinates, off-curve point, missing or non-string member, unsupported extra member); portable
    - _Requirements: R5.7, R5.8, R13.4_
    - Design: Testing Strategy (Generators, Keys)
    - DoD: P0-D3 (supports)
  - [x] 4.4 Add the `keys` section to the vectors file and extend the vectors guard
    - A Public_JWK, its 33-byte compressed point (hex) and its fingerprint (hex), plus a point with a wrong prefix and an off-curve compressed point as rejected inputs; values computed outside the package (a throwaway script using `node:crypto` ECDH compressed output and SHA-256, deleted after use, with the method recorded in `source`); no private key in the file
    - This task owns the edits of the vectors file and `test/support/vectors.ts` for group 4
    - _Requirements: R5.12, R5.13_
    - Design: "Known_Answer_Vectors", "P-256 point helpers" (constants verified by vectors)
    - DoD: P0-D3 (supports)
  - [x] 4.5 Export `keys` from `src/index.ts`
    - Add key functions and types (`PrivateJwk`, `KeyPair`, `CryptoKeyHandle`) to the public exports; `p256` stays internal
    - This task owns the `index.ts` edit for group 4
    - _Requirements: R1.5_
    - Design: "Module layout" (`index.ts`)
    - DoD: P0-D1 (supports)
  - [x] 4.6 Write the key flag and export-shape tests
    - `test/keys-flags.test.ts` in both projects: default private key non-extractable, the flag works, the public key is exportable in both cases, exporting a non-extractable private key throws `ProgrammerError`, the exported member sets are exact, `use`/`key_ops`/`ext`/`alg` do not change usages. These check the runtime behaviour assumed in the design on Node and Workers; if a runtime disagrees, record it and STOP for the owner (design reading R5.2)
    - _Requirements: R5.1, R5.2, R5.3, R5.4, R5.5, R5.6, R5.9_
    - Design: Testing Strategy (Key flags), "Readings of requirements that are hard as written" (R5.2)
    - DoD: P0-D3 (supports)
  - [x] 4.7 Write the key known-answer and curve-constant tests
    - `test/keys-vectors.test.ts`: the `keys` vectors (compressed form, fingerprint, rejected inputs); every generated public key passes `isOnCurve`; decompress then compress reproduces the vector
    - _Requirements: R5.12, R5.13, R5.7_
    - Design: "P-256 point helpers" (constants checked at task time)
    - DoD: P0-D3 (supports)
  - [x] 4.8 Write property test for key export and import
    - **Property 15: Key export and import round trip**
    - **Validates: Requirements 5.3, 5.4, 5.10, 5.11**
    - Tag `Feature: s-crypto, Property 15: Key export and import round trip`; runs with `CRYPTO_PBT_RUNS`; a fresh key pair per run
    - DoD: P0-D3 (supports), P1-D6 (supports)
  - [x] 4.9 Write property test for import failure and ignored members
    - **Property 16: Import fails closed and ignores optional members**
    - **Validates: Requirements 3.4, 5.7, 5.8, 5.9**
    - Tag `Feature: s-crypto, Property 16: Import fails closed and ignores optional members`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P0-D3 (supports), P1-D6 (supports)
  - [x] 4.10 Write property test for compressed points and the fingerprint
    - **Property 17: Compressed point conversions and fingerprint**
    - **Validates: Requirements 5.12, 5.13**
    - Tag `Feature: s-crypto, Property 17: Compressed point conversions and fingerprint`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P0-D3 (supports), P1-D6 (supports)
  - [x] 4.11 Run the group verification (group 4)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm --filter @wraith/crypto check` and the Biome check for `packages/crypto`; all clean; list the files for the commit
    - _Requirements: R5.14_
    - Design: "Build, resolution and ordering"
    - DoD: P0-D1 (supports)

- [x] 5. Scope bytes, sign, verify, requestHash and the P0-D3 properties (P0)
  - DoD: P0-D3 (sign then verify, mutate any value, byte and signature at 1,000 runs), PBT #6 crypto part (P1-D6 supports), P0-D1 (supports). Requirements: R3, R7, R8, R9, R13.4 to R13.11, R13.13, R13.15. Design: "Signing and verification", "`requestHash`", "`scopeBytes`", Properties 5 to 14.
  - Files owned: `packages/crypto/src/{scope-bytes,sign,request-hash,index}.ts`, `fixtures/crypto/known-answers.json`, `packages/crypto/test/support/{vectors,envelopes}.ts`, `packages/crypto/test/{vectors-signature,arbitraries-complete,failure-model,sign-verify,mutate-value,mutate-bytes,mutate-signature,outside-scope,wrong-key,verify-never-throws,failures-content-free,request-hash,jcs-rejects}.test.ts`, `packages/crypto/test/{verify-order,verify-no-webcrypto}.node.test.ts`, `docs/PHASE-STATUS.md` (P0-D3 row only).
  - [x] 5.1 Create `scope-bytes.ts`
    - `scopeBytes(input)` calls `signatureScope(input)` of the protocol package and canonicalizes the result; `ProgrammerError("missing_body")` when `body` is `undefined`; the only place a scope is canonicalized
    - _Requirements: R7.1, R7.2, R7.3, R7.6, R9.2, R8.3_
    - Design: "`scopeBytes` (`scope-bytes.ts`)", "Sign, verify and requestHash data flow"
    - DoD: P0-D3
  - [x] 5.2 Create `sign.ts`
    - `signBytes` (ECDSA P-256 SHA-256, requires 64 bytes, `webcrypto_failed` with fixed message), `sign` (returns `{by, alg: "ES256", value}`; `by` is only copied; no schema validation; no mutation of the envelope), `verifyBytes` and `verify` as one `return failClosed(...)` expression each: shape guards read `sig.alg` and `sig.value` only, `alg !== "ES256"` and `v !== 1` return `false` before any WebCrypto call, signature decodes to exactly 64 bytes, key resolved by shape (a plain record is a Public_JWK imported via `importPublicKey`; anything else must be a `public` ECDSA P-256 handle with the `verify` usage), then `scopeBytes` and `verifyBytes`
    - The doc comment of `verify` states the Signed_Member rule (frames parsed with `parseRaw` are verified with `parsed.signed`) and that `true` means nothing about freshness, roster or authorization; no caching of keys; no roster, replay or `sig.by` decision
    - _Requirements: R7.1 to R7.5, R7.7 to R7.9, R8.1 to R8.14, R3.1 to R3.3_
    - Design: "Signing and verification (`sign.ts`)"
    - DoD: P0-D3
  - [x] 5.3 Create `request-hash.ts`
    - `requestHash(input)` is `sha256Base64Url(scopeBytes(input))` (no `meta.type` check); `requestHashEquals(a, b)` decodes both with the strict decoder, requires 32 bytes each, compares with `equalBytesFixed`, returns `false` for anything malformed and never throws (own try/catch)
    - _Requirements: R9.1 to R9.8_
    - Design: "`requestHash` (`request-hash.ts`)"
    - DoD: P0-D3 (supports), P1-D6 (supports; PBT #6)
  - [x] 5.4 Export sign, verify and requestHash from `src/index.ts`
    - Add `scopeBytes` only if design.md lists it as public; export `sign`, `verify`, `signBytes`, `verifyBytes`, `requestHash`, `requestHashEquals`
    - This task owns the `index.ts` edit for group 5
    - _Requirements: R1.5_
    - Design: "Module layout" (`index.ts`)
    - DoD: P0-D1 (supports)
  - [x] 5.5 Add the `requestHash` and `signature` sections to the vectors file and extend the vectors guard
    - `requestHash`: a hand-written `approval.request` envelope (it need not pass `parseRaw` until S-protocol adds the type), its Canonical_Bytes (hex), digest (hex) and Request_Hash, computed outside the package with a throwaway script that must NOT import `@wraith/crypto` (the package under test); the canonical bytes come from `test/support/jcs-reference.ts` (task 3.2) or from hand-written JSON text; the script is deleted after use and not committed; the method is recorded in the vector's `source` field
    - `signature`: a Public_JWK, an envelope, a `sig.value` and `expected: true`, plus two negative variants (one changed byte of the envelope, one changed signature bit) with `expected: false`; produced once by a throwaway script that must NOT import `@wraith/crypto`: it signs with `node:crypto` (ECDSA P-256, SHA-256, `dsaEncoding: "ieee-p1363"` so the signature is the raw 64-byte r||s) over canonical bytes taken from `test/support/jcs-reference.ts` (task 3.2) or from hand-written JSON text, using an ephemeral key that is discarded; the script is deleted after use and not committed; the method is recorded in the vector's `source` field; so the file contains no private key and passes the future `secret-scan` hook
    - This task owns the edits of the vectors file and `test/support/vectors.ts` for group 5
    - _Requirements: R9.9, R13.15_
    - Design: "Known_Answer_Vectors" (`requestHash`, `signature`)
    - DoD: P0-D3, P0-D6 (supports: the file must pass the `secret-scan` hook owned by the other P0 hook specs)
  - [x] 5.6 Create the signed-envelope test support `test/support/envelopes.ts`
    - Builds, per `MESSAGE_TYPES` entry, a signed envelope from `ENVELOPE_ARBITRARIES` and `validRawEnvelopeArb` of `@wraith/protocol/testing/arbitraries` with the placeholder `sig` replaced by a real signature; the mutation generator (choose a node of the `{meta, body}` tree by an index arbitrary, then a mutation kind: changed leaf, added, removed or renamed member, changed, added or removed array element, type change) with the precondition that the canonical bytes of the mutated value differ; a recording proxy that logs which top-level members are read; the type list is read from `MESSAGE_TYPES`, never hard-coded
    - Declares no message shape
    - _Requirements: R13.4, R13.5, R13.13_
    - Design: Testing Strategy (Generators)
    - DoD: P0-D3
  - [x] 5.7 Write the known-answer tests for `requestHash` and the signature vector
    - `test/vectors-signature.test.ts`: the `requestHash` vector (bytes, digest and hash), and the `signature` vector verifies `true` and both negative variants verify `false`; portable
    - _Requirements: R9.9, R13.15_
    - Design: "Unit and example tests"
    - DoD: P0-D3
  - [x] 5.8 Write the arbitrary completeness test
    - `test/arbitraries-complete.test.ts`: fails if `ENVELOPE_ARBITRARIES` lacks a key of `MESSAGE_TYPES`, so a new protocol type cannot be silently skipped (coverage is the 8 registry types today and grows as S-protocol P1 lands)
    - _Requirements: R13.4, R13.13_
    - Design: Testing Strategy (Generators)
    - DoD: P0-D3
  - [x] 5.9 Write the failure-model table test
    - `test/failure-model.test.ts`: feeds `verify`, `verifyBytes` and `requestHashEquals` each input of R3.8 (`undefined`, `null`, a number, a string, an empty object, an array, a cyclic object, a scope with `meta` missing, a scope with a `bigint`, a non-string signature, signatures of 63 and 65 decoded bytes, a padded signature, a public key with `d`, a key on another curve, a key with a missing `x`) and asserts `false` and no exception; the HMAC and payload verifiers are added in 12.1
    - Required: direct evidence for R3.8 (hostile inputs return false)
    - _Requirements: R3.1, R3.2, R3.8, R8.13_
    - Design: Testing Strategy (Failure-model table)
    - DoD: P0-D3
  - [x] 5.10 Write property test for sign then verify
    - **Property 6: Sign then verify holds for every message type**
    - **Validates: Requirements 7.1, 7.4, 7.8, 7.9, 7.10, 8.1, 8.2, 13.4**
    - One property per `MESSAGE_TYPES` entry (fallback decided after measuring: one property over `fc.constantFrom(...MESSAGE_TYPES)` plus a per-type coverage assertion); fresh key pair per run; public key as a JWK and as an imported handle; after `JSON.stringify` and `parseRaw` with `parsed.signed`; an extra stripped body member verifies with `parsed.signed` and not with `parsed.envelope`
    - Tag `Feature: s-crypto, Property 6: Sign then verify holds for every message type`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P0-D3, P1-D6 (supports; PBT #6)
  - [x] 5.11 Write property test for mutating any value
    - **Property 7: Mutating any value of meta or body is rejected**
    - **Validates: Requirements 8.4, 13.5**
    - Tag `Feature: s-crypto, Property 7: Mutating any value of meta or body is rejected`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P0-D3, P1-D6 (supports; PBT #6)
  - [x] 5.12 Write property test for mutating any byte
    - **Property 8: Mutating any byte is rejected**
    - **Validates: Requirements 7.7, 8.10, 13.6**
    - Tag `Feature: s-crypto, Property 8: Mutating any byte is rejected`; runs with `CRYPTO_PBT_RUNS`; a fresh key pair per run
    - DoD: P0-D3, P1-D6 (supports; PBT #6)
  - [x] 5.13 Write property test for mutating the signature
    - **Property 9: Mutating the signature is rejected**
    - **Validates: Requirements 8.5, 13.7**
    - Tag `Feature: s-crypto, Property 9: Mutating the signature is rejected`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P0-D3, P1-D6 (supports; PBT #6)
  - [x] 5.14 Write property test for fields outside the signature scope
    - **Property 10: Fields outside the signature scope have no effect**
    - **Validates: Requirements 7.2, 7.3, 8.3, 8.8, 9.4, 13.8**
    - Includes the recording-proxy clause: only `v`, `meta` and `body` are read by `sign`, `verify` and `requestHash`
    - Tag `Feature: s-crypto, Property 10: Fields outside the signature scope have no effect`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P0-D3, P1-D6 (supports; PBT #6, SI-4)
  - [x] 5.15 Write property test for wrong key, wrong version and wrong algorithm
    - **Property 11: Wrong key, wrong version and wrong algorithm are rejected**
    - **Validates: Requirements 8.6, 8.7, 8.9, 13.9**
    - Tag `Feature: s-crypto, Property 11: Wrong key, wrong version and wrong algorithm are rejected`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P0-D3
  - [x] 5.16 Write property test that verification never throws
    - **Property 12: Verification never throws**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.8, 8.13, 13.10**
    - Covers `verify`, `verifyBytes` and `requestHashEquals` with `fc.anything` (bigint, date, map, set, typed array, sparse array, null-prototype and boxed values enabled) plus the hostile generators; the HMAC, pairing and payload verifiers are added in 12.1
    - Tag `Feature: s-crypto, Property 12: Verification never throws`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P0-D3
  - [x] 5.17 Write the Property 12 variant without WebCrypto (node-only)
    - **Property 12: Verification never throws**
    - **Validates: Requirements 3.3, 13.10**
    - `test/verify-no-webcrypto.node.test.ts`: removes `globalThis.crypto`, asserts every verifier resolves to `false`, restores it in `afterEach`; same tag as 5.16 plus `(no WebCrypto)`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P0-D3
  - [x] 5.18 Write property test that failures never contain content
    - **Property 13: Failures never contain content**
    - **Validates: Requirements 2.9, 3.6, 11.12**
    - Places marker strings in keys, signatures, payload fields and Non_JSON_Values and asserts neither the thrown `ProgrammerError`, the returned `CryptoFailure` nor their serialization contains the marker; this task covers the P0 functions, the secret clause (11.12) is added in 12.1
    - Tag `Feature: s-crypto, Property 13: Failures never contain content`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P0-D3 (supports), P1-D6 (supports)
  - [x] 5.19 Write property test for requestHash
    - **Property 14: requestHash binds the signed bytes**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.5, 9.6, 9.8, 13.11**
    - Loops over `MESSAGE_TYPES`; typed envelope and Signed_Member give the same 43-character value; `requestHashEquals` is `true` exactly for equal valid encodings
    - Tag `Feature: s-crypto, Property 14: requestHash binds the signed bytes`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P0-D3 (supports), P1-D6 (supports; PBT #6)
  - [x] 5.20 Extend the Property 5 test to scope bytes, sign and requestHash
    - **Property 5: JCS rejects every Non_JSON_Value at any depth**
    - **Validates: Requirements 3.5, 7.6, 9.7**
    - Edit `test/jcs-rejects.test.ts` (owned by 3.10): a scope with a Non_JSON_Value or without `body` makes `sign` and `requestHash` throw `ProgrammerError`
    - Tag unchanged; runs with `CRYPTO_PBT_RUNS`
    - DoD: P0-D3 (supports)
  - [x] 5.21 Write the order-of-checks test (node-only)
    - `test/verify-order.node.test.ts`: with `crypto.subtle.verify` replaced by a counting stub, `verify` with a wrong `alg` or `v !== 1` returns `false` with zero calls; the stub is restored in `afterEach`
    - _Requirements: R8.6, R8.7_
    - Design: Testing Strategy (Order-of-checks)
    - DoD: P0-D3 (supports)
  - [x] 5.22 Update `docs/PHASE-STATUS.md` for P0-D3
    - Set the P0-D3 row to `pass` only if every property of group 5 and the round trip passed at 1,000 runs in the `node` project in the group-5 verification; evidence text: the command (`pnpm --filter @wraith/crypto test`), `CRYPTO_PBT_RUNS = 1000` in `packages/crypto/test/config.ts`, the property numbers 6 to 9 and the registry types covered (count read from `MESSAGE_TYPES`), vitest and fast-check versions, and the date; otherwise leave `todo` and write the reason
    - Edit only the P0-D3 row; the P0-D2 row is 8.5
    - _Requirements: R13.17, R14.7_
    - Design: "Mapping to Definition of Done items"
    - DoD: P0-D3
  - [x] 5.23 Run the group verification (group 5)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm --filter @wraith/crypto check` and the Biome check for `packages/crypto`; all clean; record the slowest property and the key generation cost; list the files for the commit
    - _Requirements: R13.17_
    - Design: "Build, resolution and ordering", Testing Strategy (Generators)
    - DoD: P0-D1 (supports), P0-D3

- [x] 6. Checkpoint - P0-D3 properties pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Boundary check and source-rule scans (P0)
  - DoD: P0-D1 (supports: the boundary check runs in `build`; CI is S-ops-packaging). Requirements: R2.2 to R2.7, R1.1, R1.3, R1.4, R3.1, R3.2, R4.7, R6.16. Design: "Boundary_Check", "Module dependency rules and diagram".
  - Files owned: `packages/crypto/scripts/check-boundaries.ts`, `packages/crypto/package.json` (scripts), `packages/crypto/test/{boundaries,source-rules,export-list}.node.test.ts`.
  - [-] 7.1 Create `scripts/check-boundaries.ts` and wire it into `build` and `check`
    - Thin wrapper that imports `checkSources` from `../../protocol/scripts/check-boundaries.ts` by relative path (import-safe), lists `src/**/*.ts` itself, applies its own dependency rule (`dependencies` may contain only `@wraith/protocol`), prefixes violations with the package name, and maps or hides the protocol requirement ids in messages; add it to the `build` and `check` scripts before `tsc`
    - Verify the two caveats at task time: `tsconfig.scripts.json` accepts the file outside the package directory, and the message wording. If either blocks, use the design fallback inside the same decision: a copy of the scanner with a test that fails when the copied functions differ from the protocol script; record the choice (8.6)
    - The script is Node-only tooling outside `src` and is imported by nothing in `src`
    - _Requirements: R2.4, R2.5, R2.6, R1.4_
    - Design: "Boundary_Check (R2.4 to R2.7)"
    - DoD: P0-D1 (supports)
  - [ ] 7.2 Write `test/boundaries.node.test.ts`
    - Runs the wrapper functions on a sample file containing each forbidden construct (`node:*`, `cloudflare:*`, `bun:*`, `require`, `Buffer`, `window`, `document`, `localStorage`) and asserts each is reported, and on the real `src` tree and asserts it passes; also asserts a dependency other than `@wraith/protocol` is reported
    - _Requirements: R2.4, R2.7, R1.4_
    - Design: "Boundary_Check"
    - DoD: P0-D1 (supports)
  - [ ] 7.3 Write `test/source-rules.node.test.ts`
    - Reuses the comment-masking scanner of the protocol script. Rules: `errors.ts`, `guard.ts`, `webcrypto.ts`, `bytes.ts` and `p256.ts` import nothing from the rest of the package (`errors.ts` imports protocol types only); `jcs.ts` imports only `utf8.ts` and `errors.ts`; `p256.ts` imports only `bytes.ts` and `keys.ts` calls it only with coordinates and the parity bit; only `keys.ts`, `scope-bytes.ts`, `sign.ts`, `request-hash.ts` and `errors.ts` import `@wraith/protocol`, through the bare specifier, with no deep path; `src` never imports `scripts/` or `test/`; no `zod`, `@noble/*`, `Math.random`, `JSON.stringify` or `console.` in `src`; `index.ts` contains re-exports only; every exported function whose name starts with `verify` is in the verifier list and its body is a single `return failClosed(...)` expression (the list is checked against the exports so a new verifier cannot be missed); a self-check on sample sources proves each rule reports a violation
    - Required: these rules are stated in the design
    - _Requirements: R1.1, R1.3, R1.4, R1.5, R3.1, R3.2, R4.7, R6.16, R2.9_
    - Design: "Module dependency rules and diagram", "Failure guard"
    - DoD: P0-D1 (supports), P0-D3 (supports)
  - [ ] 7.4 Write the export-list test
    - Required: it is a design-rule scan and the only test for R3.7, R10.11, R11.11 and R14.1
    - Asserts the public exports include no function that parses or formats the `Authorization: WraithSig` header, maps a result to an `ErrorCode`, stores a key, or checks a roster, replay or clock
    - _Requirements: R3.7, R10.11, R11.11, R14.1_
    - Design: Testing Strategy (Scans)
    - DoD: P0-D1 (supports)
  - [ ] 7.5 Run the group verification (group 7)
    - Run `pnpm -r test`, `pnpm -r build` (now including the boundary script), `pnpm typecheck`, `pnpm --filter @wraith/crypto check` and the Biome check for `packages/crypto`; all clean; list the files for the commit
    - _Requirements: R2.4_
    - Design: "Build, resolution and ordering"
    - DoD: P0-D1 (supports)

- [ ] 8. Workers project with `@cloudflare/vitest-plugin` and the P0-D2 evidence (P0)
  - DoD: P0-D2 (JCS byte-equality on Node and in the Workers runtime; evidence "V8 only"), P0-D1 (supports), P0-D3 (supports: the portable properties also run in Workers). Requirements: R12, R13.14, R13.17. Design: "Workers integration: task-time verification", "Why Node plus Workers is weaker than a browser run", Design choice 1.
  - Files owned: `packages/crypto/package.json` (devDependencies), `pnpm-lock.yaml`, `packages/crypto/vitest.config.ts`, `packages/crypto/wrangler.jsonc` (only if the plugin README asks for it), `packages/crypto/tsconfig.scripts.json` (only if the plugin needs types), `packages/crypto/test/config-projects.node.test.ts`, `docs/PHASE-STATUS.md` (P0-D2 row only), `docs/DECISIONS-PENDING.md` (only for agent-made decisions).
  - [ ] 8.1 Pin and install `@cloudflare/vitest-plugin` and its required peers
    - Choose one exact version of `@cloudflare/vitest-plugin` at install time; confirm through the npm registry that the peer range of that exact version includes `vitest` 5.0.5; read the README of that exact version and list its required peer or dev dependencies (for example `wrangler`, `workerd`) and pin them exactly; install with `pnpm`; record every installed version
    - It is a plugin, not a pool: do not write a pool option block from memory. If the peer range excludes 5.0.5, STOP and report to the owner with the versions and the range; no downgrade of Vitest and no package-local Vitest on your own initiative
    - _Requirements: R12.4, R12.5_
    - Design: "Workers integration: task-time verification" (steps 1 to 3)
    - DoD: P0-D2
  - [ ] 8.2 Add the `workers` project to `vitest.config.ts`
    - Register the plugin and point it at a Workers config exactly as the README of the pinned version says (not guessed); the `workers` project runs `test/**/*.test.ts` except `*.node.test.ts`; both projects keep `resolve.conditions` including `"@wraith/source"`; create `wrangler.jsonc` only if the README requires one (compatibility date; no Node compatibility flag unless the plugin needs it)
    - This task owns the first edit of the `workers` project in `vitest.config.ts`; 8.3 owns the timeout
    - _Requirements: R12.2, R12.9, R13.14_
    - Design: Testing Strategy (Projects), "Workers integration" (step 2)
    - DoD: P0-D2
  - [ ] 8.3 Run the suite once in both projects and tune the timeout
    - Run `pnpm --filter @wraith/crypto test` and confirm the `workers` project runs `jcs-vectors.test.ts`, the base64url and sha256 vectors, Properties 1 to 17 portable tests and the signature vectors; fix test-side portability problems only (no `node:` import in portable files; JSON import attribute accepted by both projects); measure key generation and the slowest 1,000-run property in Workers and set a generous `testTimeout` in `vitest.config.ts` (no number is fixed by the design)
    - If the Workers suite unexpectedly fails for a reason other than test portability, STOP and report to the owner with the versions and the error text (no payload data). Do not switch approach, downgrade Vitest, add a package-local Vitest, or run the tests in Miniflare from a script; the Workers run of P0-D2 stays unproven until the owner decides
    - _Requirements: R12.2, R12.5, R12.6, R12.7, R13.14_
    - Design: "Workers integration" (steps 4 and 5), Testing Strategy (timeouts)
    - DoD: P0-D2, P0-D3 (supports)
  - [ ] 8.4 Write the project config test and the no-`node:` scan
    - `test/config-projects.node.test.ts`: `vitest.config.ts` defines both projects, the `workers` project excludes `*.node.test.ts`, `package.json` has `test` and `build` scripts, the P0-D2 suite file (`jcs-vectors.test.ts`) is not `*.node.test.ts` and is non-empty; a scan that no non-node test file and no `test/support/*.ts` imports `node:*`
    - _Requirements: R12.9, R12.10, R13.17_
    - Design: "Unit and example tests" (Config test)
    - DoD: P0-D1 (supports), P0-D2
  - [ ] 8.5 Update `docs/PHASE-STATUS.md` for P0-D2 and record the reuse note
    - Set the P0-D2 row to `pass` only if the JCS suite passed in both the `node` and the `workers` project; otherwise `pending` with the reason and the versions tried (R12.6). Evidence text must state: the commands, the runtime versions (Node, vitest 5.0.5, `@cloudflare/vitest-plugin` and its pinned peers, workerd), "V8 only: Node and Workers; the browser run is the P1 task 12.2", that the owner accepted `@cloudflare/vitest-plugin` (renamed from `@cloudflare/vitest-pool-workers`, C79) as the "vitest-pool-workers" evidence, the vectors file path, and the working project shape and command so that S-protocol task 19.1 can reuse the same package and config (S-protocol tasks are not edited)
    - Edit only the P0-D2 row and, if needed, one short note line under the table; P0-D1 stays `todo` (CI is S-ops-packaging)
    - _Requirements: R12.3, R12.8, R14.7_
    - Design: "Mapping to Definition of Done items", "Why Node plus Workers is weaker than a browser run"
    - DoD: P0-D2, P0-D1 (supports)
  - [ ] 8.6 Record agent-made decisions in `docs/DECISIONS-PENDING.md` (conditional)
    - Only if an agent decision was taken: the `@wraith/source` fallback applied in 2.2, the boundary-check copy fallback in 7.1, the per-type loop versus `fc.constantFrom` choice in 5.10, or a Workers timeout; one row each (id, date, question, default taken, impact if changed, resolved); skip the task body if none was taken
    - _Requirements: R14.5_
    - Design: "Build, resolution and ordering", "Boundary_Check"
    - DoD: P0-D1 (supports)
  - [ ] 8.7 Run the group verification (group 8)
    - Run `pnpm -r test` (both projects), `pnpm -r build`, `pnpm typecheck`, `pnpm --filter @wraith/crypto check` and the Biome check for `packages/crypto`; all clean; list the files for the commit
    - _Requirements: R12.10_
    - Design: "Build, resolution and ordering"
    - DoD: P0-D1 (supports), P0-D2

- [ ] 9. Checkpoint - P0 complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. HMAC-SHA-256 and the pairing HMAC (P1)
  - DoD: P1-D6 (supports; Properties 18 and 19, PBT #22 crypto part: S-pairing-trust owns the rest), P0-D1 (supports). Requirements: R11, R3.1, R13.10. Design: "HMAC and pairing (`hmac.ts`)", Properties 18 and 19.
  - Files owned: `packages/crypto/src/{hmac,index}.ts`, `fixtures/crypto/known-answers.json`, `packages/crypto/test/support/vectors.ts`, `packages/crypto/test/{vectors-hmac,hmac,pairing-hmac,hmac-empty-secret}.test.ts`.
  - [ ] 10.1 Create `hmac.ts`
    - `hmacSha256` (empty secret gives `ProgrammerError("empty_secret")`; raw HMAC key import), `verifyHmacSha256` (`unknown` parameters, 32-byte tag required, `subtle.verify("HMAC", ...)`, empty secret gives `false`, one `return failClosed(...)`), `generatePairingSecret` (`randomBytes(16)`, the only generator), `pairingHmac` (message `ownerPub` compressed 33 bytes, `spaceId` UTF-8, `rosterVersion` through `u64be`, SHA-256 of the canonical bytes of the entries sorted by `memberId` UTF-16 code units on a copy; duplicate `memberId` and non-safe-integer `rosterVersion` are `ProgrammerError`; entries canonicalized as given; Base64url tag), `verifyPairingHmac` (`unknown` input, duplicate `memberId` gives `false`, constant-time tag compare with `verifyHmacSha256` semantics, one `return failClosed(...)`)
    - No `WRP1-` code, base32, CRC, ticket or pinning logic; the secret never appears in an error
    - _Requirements: R11.1 to R11.12, R11.15_
    - Design: "HMAC and pairing (`hmac.ts`)"
    - DoD: P1-D6 (supports)
  - [ ] 10.2 Export `hmac` from `src/index.ts`
    - This task owns the `index.ts` edit for group 10
    - _Requirements: R1.5_
    - Design: "Module layout" (`index.ts`)
    - DoD: P0-D1 (supports)
  - [ ] 10.3 Add the `hmac` and `pairingHmac` sections to the vectors file and extend the vectors guard
    - RFC 4231 test cases 1, 2 and 6 (published values), and a Pairing_HMAC with one entry and one with two entries (ownerPub, spaceId, rosterVersion, entries, artificial patterned secret, tag), computed outside the package with a throwaway script that must NOT import `@wraith/crypto` (the package under test): the pairing HMAC is computed with `node:crypto` HMAC-SHA-256 over the framing of architecture §3.4, written independently in the script, with the canonical bytes of the sorted roster entries taken from `test/support/jcs-reference.ts` (task 3.2) or from hand-written JSON text, and the compressed-point bytes derived by an independent method (computed from the JWK coordinates by hand-written code in the throwaway script: prefix 0x02 or 0x03 by the parity of `y`, then the 32 bytes of `x`); the script is deleted after use and not committed; the method is recorded in the vector's `source` field; secrets are obviously artificial patterned bytes
    - This task owns the edits of the vectors file and `test/support/vectors.ts` for group 10
    - _Requirements: R11.13_
    - Design: "Known_Answer_Vectors" (`hmac`, `pairingHmac`)
    - DoD: P1-D6 (supports), P0-D6 (supports: the file must pass the `secret-scan` hook)
  - [ ] 10.4 Write the HMAC and pairing known-answer tests
    - `test/vectors-hmac.test.ts`: RFC 4231 cases through `hmacSha256` and `verifyHmacSha256`; both Pairing_HMAC vectors through `pairingHmac` and `verifyPairingHmac`; portable
    - _Requirements: R11.13_
    - Design: "Unit and example tests"
    - DoD: P1-D6 (supports)
  - [ ] 10.5 Write property test for HMAC-SHA-256
    - **Property 18: HMAC-SHA-256 verifies its own tag and nothing else**
    - **Validates: Requirements 11.1, 11.2, 11.4**
    - Tag `Feature: s-crypto, Property 18: HMAC-SHA-256 verifies its own tag and nothing else`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P1-D6 (supports)
  - [ ] 10.6 Write property test for the pairing HMAC
    - **Property 19: Pairing HMAC covers every input and ignores entry order**
    - **Validates: Requirements 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.15**
    - Tag `Feature: s-crypto, Property 19: Pairing HMAC covers every input and ignores entry order`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P1-D6 (supports; PBT #22 crypto part, rest is S-pairing-trust)
  - [ ] 10.7 Write the empty-secret table test
    - `test/hmac-empty-secret.test.ts`: each HMAC computation function (`hmacSha256`, `pairingHmac`) throws `ProgrammerError`; each verification function (`verifyHmacSha256`, `verifyPairingHmac`) returns `false` without throwing
    - Required: direct evidence for R11.14
    - _Requirements: R11.4, R11.14_
    - Design: Testing Strategy (Empty-secret table)
    - DoD: P1-D6 (supports)
  - [ ] 10.8 Run the group verification (group 10)
    - Run `pnpm -r test` (both projects), `pnpm -r build`, `pnpm typecheck`, `pnpm --filter @wraith/crypto check` and the Biome check for `packages/crypto`; all clean (the source-rules scan of 7.3 must pass with the new verifiers); list the files for the commit
    - _Requirements: R11.11_
    - Design: "Build, resolution and ordering"
    - DoD: P0-D1 (supports)

- [ ] 11. WebSocket authentication and WraithSig payloads (P1)
  - DoD: P1-D6 (supports; Properties 20 and 21), P0-D1 (supports). Requirements: R10, R3.1. Design: "WebSocket and API payloads (`payloads.ts`)", Properties 20 and 21.
  - Files owned: `packages/crypto/src/{payloads,index}.ts`, `fixtures/crypto/known-answers.json`, `packages/crypto/test/support/vectors.ts`, `packages/crypto/test/{vectors-payloads,payload-builders,payload-kinds}.test.ts`.
  - [ ] 11.1 Create `payloads.ts`
    - `buildWsAuthPayload`, `buildWraithSigPayload` (raw body bytes or `undefined`; `bodySha256` is `""` only when no body was given, the Base64url SHA-256 otherwise including an empty body; `ts` a safe integer else `ProgrammerError`; `method`, `path`, `query` passed through unchanged), `signWsAuth`, `signWraithSig` (`signBytes` over `canonicalizeBytes(payload)`, Base64url), `verifyWsAuth` and `verifyWraithSig` (require a plain record with exactly the member set and primitive types of the kind, then verify over its canonical bytes; no clock, nonce or roster check; one `return failClosed(...)` each)
    - No function parses or formats the `Authorization: WraithSig ...` header
    - _Requirements: R10.1 to R10.9, R10.11_
    - Design: "WebSocket and API payloads (`payloads.ts`)"
    - DoD: P1-D6 (supports)
  - [ ] 11.2 Export `payloads` from `src/index.ts`
    - This task owns the `index.ts` edit for group 11
    - _Requirements: R1.5_
    - Design: "Module layout" (`index.ts`)
    - DoD: P0-D1 (supports)
  - [ ] 11.3 Add the `payloads` section to the vectors file and extend the vectors guard
    - One ws-auth payload and one WraithSig payload with a body and one without, each with Canonical_Bytes in hex, computed outside the package (throwaway script, deleted after use); `bodySha256` values for the body case from an independent SHA-256
    - This task owns the edits of the vectors file and `test/support/vectors.ts` for group 11
    - _Requirements: R10.12_
    - Design: "Known_Answer_Vectors" (`payloads`)
    - DoD: P1-D6 (supports)
  - [ ] 11.4 Write the payload known-answer tests
    - `test/vectors-payloads.test.ts`: builders produce payloads whose `canonicalizeBytes` equals the hex vectors, with and without a body; portable
    - _Requirements: R10.12, R10.5, R10.6_
    - Design: "Unit and example tests"
    - DoD: P1-D6 (supports)
  - [ ] 11.5 Write property test for the payload builders and signatures
    - **Property 20: Payload builders and signatures for ws-auth and WraithSig**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9**
    - Tag `Feature: s-crypto, Property 20: Payload builders and signatures for ws-auth and WraithSig`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P1-D6 (supports)
  - [ ] 11.6 Write property test for kind separation
    - **Property 21: The three signed payload kinds never verify as each other**
    - **Validates: Requirements 10.10**
    - Includes the fixed sample of each kind with all six cross-verifications returning `false` (the R10.10 test)
    - Tag `Feature: s-crypto, Property 21: The three signed payload kinds never verify as each other`; runs with `CRYPTO_PBT_RUNS`
    - DoD: P1-D6 (supports)
  - [ ] 11.7 Run the group verification (group 11)
    - Run `pnpm -r test` (both projects), `pnpm -r build`, `pnpm typecheck`, `pnpm --filter @wraith/crypto check` and the Biome check for `packages/crypto`; all clean; list the files for the commit
    - _Requirements: R10.11_
    - Design: "Build, resolution and ordering"
    - DoD: P0-D1 (supports)

- [ ] 12. Close-out: P1 verifiers in the shared properties, browser run, README (P1)
  - DoD: P1-D6 (supports), P0-D2 (supports: the browser claim of PBT #14 is R13.16), P0-D1 (supports). Requirements: R3.8, R11.12, R13.10, R13.16, R1.6. Design: Testing Strategy ("Why Node plus Workers is weaker than a browser run"), "Error Handling".
  - Files owned: `packages/crypto/test/{failure-model,verify-never-throws,failures-content-free}.test.ts`, `packages/crypto/vitest.config.ts`, `packages/crypto/package.json` (browser dev dependencies), `pnpm-lock.yaml`, `packages/crypto/README.md`, `docs/PHASE-STATUS.md` and `docs/DECISIONS-PENDING.md` (browser run note only).
  - [ ] 12.1 Extend the failure-model table and Properties 12 and 13 to the P1 verifiers
    - **Property 12: Verification never throws**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.8, 13.10**
    - **Property 13: Failures never contain content**
    - **Validates: Requirements 3.6, 11.12**
    - Add `verifyHmacSha256`, `verifyPairingHmac`, `verifyWsAuth` and `verifyWraithSig` to the tables of `test/failure-model.test.ts` and `test/verify-never-throws.test.ts`, and the secret and payload-field markers to `test/failures-content-free.test.ts`; tags unchanged; run with `CRYPTO_PBT_RUNS`
    - DoD: P1-D6 (supports)
  - [ ] 12.2 Browser run of the Known_Answer_Vectors (R13.16, conditional)
    - Add a Vitest browser-mode project that runs the JCS vectors, the signature vector and the other portable vector tests of the same JSON file, only if the browser provider and engine can be installed from npm dependencies without a human step or a manual binary install; the choice of provider and browser engine is recorded in `docs/DECISIONS-PENDING.md`; read the Vitest browser-mode documentation of the pinned version at task time and do not guess its config
    - If it cannot run unattended, do not mark it done: record the browser run as pending in `docs/PHASE-STATUS.md` (the alternative is an S-pwa-shell test that loads the same vectors file) and keep this task open. Until it passes, the P0-D2 evidence remains "V8 only: Node and Workers"; when it passes, add the engine name to that evidence
    - _Requirements: R13.16, R2.8_
    - Design: Testing Strategy ("Why Node plus Workers is weaker than a browser run"), Design choice (browser run, resolved decision 5)
    - DoD: P0-D2 (supports: cross-engine claim), P1-D6 (supports; PBT #14 browser part)
  - [ ] 12.3 Finish `README.md`
    - List the exported functions, the rule that the package depends on `@wraith/protocol` and redeclares nothing, the rule that it never stores keys, the Signed_Member rule for `verify`, the statement that `true` does not mean fresh, unrevoked or authorized, the fresh-clone command order (what `pnpm -r test`, `check`, `pnpm typecheck` and `pnpm -r build` need), and the exact-version note for the Workers dependencies
    - _Requirements: R1.6, R8.2, R8.11, R14.3_
    - Design: Module layout (`README.md`), "Build, resolution and ordering"
    - DoD: P0-D1 (supports)
  - [ ] 12.4 Run the group verification (group 12)
    - Run `pnpm -r test` (all projects), `pnpm -r build`, `pnpm typecheck`, `pnpm --filter @wraith/crypto check` and the Biome check for `packages/crypto`; all clean; list the files for the commit
    - _Requirements: R12.10, R13.17_
    - Design: "Build, resolution and ordering"
    - DoD: P0-D1 (supports)

- [ ] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and cover extra unit tests only (2.11, 2.12, 3.11). Property tests, the JCS vectors on both runtimes, the 1,000-run P0-D3 properties, the hostile-input table, the empty-secret table and all source-scan tests that enforce design rules are required.
- Blocked or conditional tasks:
  - Task 1.1 is a precondition. If the S-protocol JWK-first commit (JWK schema and `@wraith/source` conditions) is missing, the whole plan stops and reports to the owner.
  - Task 2.2 is conditional: the design fallback for `tsc` source imports is applied only if the first attempt fails; if Vitest cannot resolve protocol from source it stops and reports.
  - Task 4.6 stops for the owner if a runtime disagrees with the assumed WebCrypto key-flag behaviour.
  - Task 7.1 is conditional: the guarded-copy fallback of the boundary script is used only if the relative import or the type-check of the file outside the package blocks.
  - Tasks 8.1 to 8.3 stop and report to the owner if `@cloudflare/vitest-plugin` does not support Vitest 5.0.5 or the Workers suite unexpectedly fails; there is no pre-approved fallback, and P0-D2 stays `pending`, not `pass`.
  - Task 8.6 is conditional on an agent-made decision having been taken.
  - Task 12.2 (browser run) is conditional on an unattended browser provider; otherwise it stays open and is recorded as pending.
- Dependency versions to pin at install time and record: `@cloudflare/vitest-plugin` and its required peers (for example `wrangler`, `workerd`). They are not chosen in this plan. Compatibility with Vitest 5.0.5 is confirmed from the registry peer range of the exact pinned version and by running the suite once. The README of the pinned plugin version is the source for the config; nothing is guessed.
- Owner decisions carried (2026-11-12): `@cloudflare/vitest-plugin` is accepted as the "vitest-pool-workers" evidence for P0-D2 and S-protocol task 19.1 reuses it; `CRYPTO_PBT_RUNS = 1000` is a local constant never imported from protocol; `verify` never throws (single `failClosed` expression, enforced by the scan in 7.3); an empty HMAC secret throws on computation and returns `false` on verification; the boundary check is a thin wrapper importing `checkSources` from the protocol script; JCS is iterative with `String(n)` numbers; Base64url is hand-written and strict; P-256 point arithmetic uses `BigInt` on public data only; vectors live in `fixtures/crypto/known-answers.json` and are loaded with a JSON import attribute; tests and `check` resolve protocol from source through `@wraith/source`, `build` and `typecheck` through `dist` and references.
- Evidence for P0-D2 is labelled "V8 only" (Node and Workers). The browser run belongs to R13.16 and is task 12.2.
- Files outside `packages/crypto` touched by this spec: `fixtures/crypto/known-answers.json`, `pnpm-lock.yaml` (dependency installs), and recording-only edits in `docs/PHASE-STATUS.md` (5.22, 8.5, 12.2) and `docs/DECISIONS-PENDING.md` (8.6, 12.2). S-protocol files and tasks, `requirements.md` and `design.md` are not edited.

## DoD Coverage Table

| DoD id | Tasks | Outside this spec |
|---|---|---|
| P0-D1 | 1.1 to 1.6, 2.x, 3.6, 3.12, 4.5, 4.11, 5.4, 5.23, 7.1 to 7.5, 8.4 to 8.7, 10.2, 10.8, 11.2, 11.7, 12.3, 12.4 (all "supports": non-empty `crypto` suites, `build` and `test` scripts, boundary check in `build`) | The CI workflow on Linux and macOS (S-ops-packaging); the P0-D1 row stays `todo` until CI exists |
| P0-D2 | 2.6, 3.1 to 3.10, 8.1 to 8.5, 12.2 (supports) | CI listing of the suite (S-ops-packaging); the browser run of the vectors (R13.16, task 12.2, or an S-pwa-shell test); reuse of the plugin pin and config by S-protocol task 19.1 (S-protocol tasks are not edited here) |
| P0-D3 | 1.4, 1.5, 5.1 to 5.22 (Properties 6 to 9 at `CRYPTO_PBT_RUNS = 1000`, plus 10 to 14), 8.3 (Workers run of the portable properties) | Nothing else; CI listing is S-ops-packaging |
| P0-D6 | 5.5, 10.3 (supports: the vectors file carries no private key and must pass the `secret-scan` hook) | The hooks and their sample-file tests (the other P0 hook specs) |
| P1-D6 | 1.4, 1.5, 2.9, 2.10, 3.8 to 3.10, 4.8 to 4.10, 5.10 to 5.19, 10.5, 10.6, 11.5, 11.6, 12.1, 12.2 (supports: all 21 properties at 1,000 runs; crypto parts of PBT #6 and #14) | The remaining §21.1 group P1 properties (S-protocol, S-relay-core, S-node-core, S-approval) |
| PBT #6 (crypto part) | 5.10 to 5.14, 5.19 (mutate any byte of `meta` or `body`, `relay.*` has no effect, `requestHash` binds the signed bytes) | Verifier-level parts: once per `meta.id`, revoked key, `requestHash` mismatch rejected at the node (S-node-core, S-relay-core, S-approval) |
| PBT #14 (JCS part) | 3.7 to 3.10 on Node, 8.3 on Workers, 12.2 (browser) | The zod round-trip half (S-protocol); the browser part until 12.2 passes |
| PBT #22 (pairing payload, crypto part) | 10.3, 10.4, 10.6 (HMAC framing, swapped entry contents, entry order has no effect) | `WRP1-` encode and decode, CRC, the offer check (S-pairing-trust); wording per architecture v4.1.7 (C79) |
| PBT #1 | None | S-relay-core |

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "1.4"] },
    { "id": 3, "tasks": ["1.5"] },
    { "id": 4, "tasks": ["1.6"] },
    { "id": 5, "tasks": ["2.1"] },
    { "id": 6, "tasks": ["2.2", "2.3", "2.4"] },
    { "id": 7, "tasks": ["2.5", "2.6"] },
    { "id": 8, "tasks": ["2.7", "2.12"] },
    { "id": 9, "tasks": ["2.8", "2.9", "2.10", "2.11"] },
    { "id": 10, "tasks": ["2.13"] },
    { "id": 11, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5"] },
    { "id": 12, "tasks": ["3.6"] },
    { "id": 13, "tasks": ["3.7", "3.8", "3.9", "3.10", "3.11"] },
    { "id": 14, "tasks": ["3.12"] },
    { "id": 15, "tasks": ["4.1", "4.4"] },
    { "id": 16, "tasks": ["4.2"] },
    { "id": 17, "tasks": ["4.3", "4.5"] },
    { "id": 18, "tasks": ["4.6", "4.7", "4.8", "4.9", "4.10"] },
    { "id": 19, "tasks": ["4.11"] },
    { "id": 20, "tasks": ["5.1", "5.5"] },
    { "id": 21, "tasks": ["5.2", "5.3"] },
    { "id": 22, "tasks": ["5.4", "5.6"] },
    { "id": 23, "tasks": ["5.7", "5.8", "5.9", "5.10", "5.11", "5.12", "5.13", "5.14", "5.15", "5.16", "5.17", "5.18", "5.19", "5.20", "5.21"] },
    { "id": 24, "tasks": ["5.22"] },
    { "id": 25, "tasks": ["5.23"] },
    { "id": 26, "tasks": ["7.1"] },
    { "id": 27, "tasks": ["7.2", "7.3", "7.4"] },
    { "id": 28, "tasks": ["7.5"] },
    { "id": 29, "tasks": ["8.1"] },
    { "id": 30, "tasks": ["8.2"] },
    { "id": 31, "tasks": ["8.3"] },
    { "id": 32, "tasks": ["8.4", "8.5", "8.6"] },
    { "id": 33, "tasks": ["8.7"] },
    { "id": 34, "tasks": ["10.1", "10.3"] },
    { "id": 35, "tasks": ["10.2"] },
    { "id": 36, "tasks": ["10.4", "10.5", "10.6", "10.7"] },
    { "id": 37, "tasks": ["10.8"] },
    { "id": 38, "tasks": ["11.1", "11.3"] },
    { "id": 39, "tasks": ["11.2"] },
    { "id": 40, "tasks": ["11.4", "11.5", "11.6"] },
    { "id": 41, "tasks": ["11.7"] },
    { "id": 42, "tasks": ["12.1", "12.2", "12.3"] },
    { "id": 43, "tasks": ["12.4"] }
  ]
}
```
