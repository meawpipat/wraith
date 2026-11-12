# Requirements Document

## Introduction

S-crypto is the second spec of Project Wraith (architecture.md §20 row 2, phases P0 to P1). It delivers `packages/crypto`: the single place where Wraith canonicalizes JSON (JCS, RFC 8785), hashes (SHA-256), signs and verifies (ECDSA P-256 with SHA-256, "ES256"), computes the pairing HMAC (HMAC-SHA-256), and imports and exports P-256 keys as JWK. Relay, node, PWA, desktop app and watch all use this package, so the same bytes are signed and verified on Node, Cloudflare Workers and browsers.

Source of truth: `docs/architecture.md` §20 row 2 and the §20 intro rules, §6.1 (Envelope, signature scope, "Who signs what", `requestHash`), §6.2 (`Sig`, `RosterEntry.signPub`, the `pair.complete` fields `ownerPub`, `rosterEntries` and `hmac`), §6.3 (WebSocket authentication challenge), §6.7 (`WraithSig` request signature), §3.4 (pairing HMAC and the `WRP1-` payload, read to find which primitives pairing needs), §12.1 (SI-3, SI-4, SI-5, SI-12), §16 (Crypto row), §18.1 (P0-D1, P0-D2, P0-D3) and §21.1 (PBT #6 and #14, crypto parts). Each requirement carries an "Implements" line so design and tasks can map back. Appendix A lists the mapping.

S-crypto depends on S-protocol (spec 1, §20 row 2): it uses the `SignatureScope` type and `signatureScope` function, the `signed` member returned by `parseRaw`, the `JWK` and `Sig` schemas, and the error codes of `@wraith/protocol`, and it does not redeclare any of them (Requirement 1). Architecture v4.1.6 (C78) fixes the byte-level choices that this spec implements: ES256 signature encoding (§6.1), pairing HMAC framing and key fingerprint (§3.4) and `WraithSig` field encodings (§6.7).

Boundary (out of scope, owned by other specs):
- Roster lookup, owner-key pinning, `sig.by` to `memberId` binding, cap checks, replay store (`meta.id`, `ts` age, API nonce), revocation and `rosterVersion` monotonicity belong to the Verifier in S-node-core, S-approval and S-pairing-trust. S-crypto only answers "do these bytes verify under this public key".
- The pairing flow, the `WRP1-` encoding (base32, CRC-16, kind byte), ticket handling, QR and text code display, and owner recovery or rotation belong to S-pairing-trust. S-crypto supplies only the primitives named in Requirement 11.
- Key storage on disk (`~/.wraith/node.key`, mode 0600), in IndexedDB (non-extractable device key), in a keychain or in watch storage belongs to S-node-core and S-pwa-shell (and S-watch-zepp). S-crypto produces and consumes key objects and JWK values; it never persists them.
- Issuing the WebSocket challenge nonce, the nonce and `ts` windows of `WraithSig`, and the `Authorization` header text format belong to S-relay-core and the API consumers.
- Zod schemas and the shape of every wire message belong to S-protocol. S-crypto declares no zod schema.
- The redactor (SI-8), the recovery-code KDF (Argon2id or PBKDF2, §16) and Web Push encryption (RFC 8291/8292) are not part of this spec.

## Glossary

- **Crypto_Package**: The workspace package `packages/crypto` (`@wraith/crypto`).
- **Protocol_Package**: The workspace package `packages/protocol` (`@wraith/protocol`), specified by S-protocol.
- **WebCrypto**: The `crypto.subtle` and `crypto.getRandomValues` APIs of the JavaScript runtime. They are the only source of cryptographic primitives and randomness in the Crypto_Package.
- **Runtime_Specific_Module**: Any import of `node:*`, `cloudflare:*` or `bun:*`, any use of `require`, `Buffer`, or a browser DOM global (`window`, `document`, `localStorage`).
- **Boundary_Check**: A script run by the Crypto_Package build and by a test that fails when a source file contains a Runtime_Specific_Module.
- **Envelope**: The message object `{v, meta, body, sig?, relay?}` (§6.1).
- **Signature_Scope**: The object `{v, meta, body}` exported as `SignatureScope` by the Protocol_Package. It excludes `sig` and `relay`.
- **Signed_Member**: The `signed` member that `parseRaw` returns: the Signature_Scope of the raw parsed JSON value, taken before the typed parse strips unknown body fields.
- **Sig**: The signature object `{by, alg, value}` declared by the Protocol_Package, where `alg` is the literal `ES256`.
- **JCS**: The JSON Canonicalization Scheme of RFC 8785.
- **Canonical_Bytes**: The UTF-8 bytes of the JCS serialization of a JSON value.
- **JSON_Value**: A value made only of `null`, booleans, finite numbers, strings, arrays of JSON_Values, and plain objects whose property values are JSON_Values.
- **Non_JSON_Value**: Any value that is not a JSON_Value, including `undefined`, functions, symbols, `bigint`, `NaN`, `Infinity`, `-Infinity`, `Date`, `Map`, `Set`, typed arrays, objects with a prototype other than `Object.prototype` or `null`, and strings that contain a lone UTF-16 surrogate.
- **Base64url**: The URL-safe base64 alphabet of RFC 4648 section 5, written without `=` padding.
- **ES256**: ECDSA over curve P-256 with SHA-256, as WebCrypto `ECDSA` with hash `SHA-256`.
- **Signature_Encoding**: The byte layout of an ES256 signature as carried in `sig.value` (§6.1, C78): raw IEEE P1363 `r||s`, 64 bytes, Base64url without padding; low-S is not enforced.
- **Public_JWK**: An EC P-256 public key in JWK form, the `JWK` schema of the Protocol_Package (`kty`, `crv`, `x`, `y`).
- **Private_JWK**: An EC P-256 private key in JWK form: a Public_JWK plus `d`. It never appears in a wire message (stored only in `node.key`, §6.3).
- **Key_Pair**: A WebCrypto ECDSA P-256 key pair produced or imported by the Crypto_Package.
- **Verify_Result**: The boolean returned by verification functions. `true` means "the bytes verify under the given public key" and nothing else.
- **Result_Object**: A returned value of the form `{ok: true, value}` or `{ok: false, code}` where `code` is an `ErrorCode` of the Protocol_Package. It is used where untrusted input can be malformed and the caller needs the reason.
- **Programmer_Error**: A call whose arguments are values built by trusted program code and that the package cannot process (for example a Non_JSON_Value passed to the canonicalizer, or a missing WebCrypto at key generation).
- **Request_Hash**: The value `requestHash(envelope)`: Base64url of the SHA-256 digest of the Canonical_Bytes of the Signature_Scope of an Envelope.
- **WS_Auth_Payload**: The object `{v: 1, purpose: "ws-auth", space, member, nonce}` signed to authenticate a WebSocket connection (§6.3).
- **WraithSig_Payload**: The object `{v: 1, member, ts, nonce, method, path, query, bodySha256}` signed to authenticate an `/api/v1` request (§6.7).
- **Pairing_Secret**: The 128-bit random secret shared out of band between a pairing member and the owner device (§3.4).
- **Pairing_HMAC**: The `hmac` field of `pair.complete`: HMAC-SHA-256 over `ownerPub‖spaceId‖rosterVersion‖SHA-256(JCS(rosterEntries sorted by memberId))` keyed by the Pairing_Secret (§3.4).
- **PBT**: A property-based test written with `fast-check`.
- **CRYPTO_PBT_RUNS**: The named constant `1000` in the Crypto_Package test configuration: the minimum number of runs of every PBT of this package (P0-D3).
- **PBT_MIN_RUNS**: The S-protocol test constant `500` (`packages/protocol/test/config.ts`). It is not used by the Crypto_Package.
- **Workers_Pool**: The Vitest project that runs tests inside the Cloudflare Workers runtime using `@cloudflare/vitest-pool-workers`.
- **Known_Answer_Vectors**: A committed JSON file of fixed inputs and expected outputs (JCS bytes, SHA-256, HMAC, a signature under a fixed public key) that every runtime and every independent implementation can check.
- **Verifier**: The node or relay code that checks signatures, the roster and caps (not part of this spec).

Naming note: function names such as `canonicalize`, `sign` and `verify` in the requirements are working names. The names `verify` and `requestHash` come from §20 row 2 and are fixed; the design phase may choose the other names.

## Requirements

### Requirement 1: Package, dependency on the protocol package, and the dependency list

**User Story:** As a maintainer, I want `packages/crypto` to reuse the protocol package's shapes and nothing else, so that no shape or error code is declared twice and the package stays small.

Implements §20 row 2 (depends on 1), §6 preamble ("Do not redeclare shapes in apps"), §20 intro rule (each spec carries the contracts it implements).

#### Acceptance Criteria

1. THE Crypto_Package SHALL declare `@wraith/protocol` as a workspace dependency and SHALL import from it only through its public entry point `@wraith/protocol`.
2. THE Crypto_Package SHALL use `SignatureScope`, `signatureScope`, the `signed` member of `parseRaw` (as the verification input), the `JWK` schema, the `Sig` shape and the `ErrorCode` type of the Protocol_Package, and SHALL NOT redeclare any of them.
3. THE Crypto_Package SHALL declare no zod schema and no wire message shape.
4. THE Crypto_Package SHALL declare no runtime dependency other than `@wraith/protocol`; JCS is implemented in-house, `@noble/curves` and `@noble/hashes` are not used, and `zod` is a transitive dependency only.
5. THE Crypto_Package SHALL export its public API from `packages/crypto/src/index.ts`.
6. THE Crypto_Package SHALL provide a README that lists the exported functions, the rule that the package depends on the Protocol_Package, and the rule that the Crypto_Package never stores keys.
7. WHEN the Protocol_Package does not yet export a symbol that this spec uses (at the time of writing: the `JWK` schema, planned in S-protocol task 8.1, a P1 task), THE ordering SHALL be: before any S-crypto coding, only the JWK schema part of S-protocol task 8.1 (and `Tier` and `BotId` if trivial) is done and committed as a separate S-protocol commit, and the rest of task 8.1 stays P1. THE S-crypto tasks SHALL be ordered after that commit and SHALL NOT declare a local JWK substitute.

### Requirement 2: Runtime independence and boundary check

**User Story:** As a developer of the relay Worker, the PWA and the node, I want one crypto package that runs unchanged on Node, Workers and browsers, so that every component produces and checks the same bytes.

Implements §20 row 2 R1 (runtime part), §16 (Crypto row: WebCrypto), P0-D1, SI-12 (no secrets in logs).

#### Acceptance Criteria

1. THE Crypto_Package SHALL obtain every hash, signature, HMAC and random byte only from WebCrypto (`crypto.subtle`, `crypto.getRandomValues`).
2. THE Crypto_Package SHALL contain no Runtime_Specific_Module in `src`.
3. THE Crypto_Package SHALL use no `Buffer`; base64url, UTF-8 and byte handling SHALL use APIs available in Node 22, Workers and current browsers (`TextEncoder`, `TextDecoder`, `Uint8Array`, `btoa`/`atob` or hand-written code).
4. WHEN the Crypto_Package is built, THE Boundary_Check SHALL fail the build IF any source file imports `node:*`, `cloudflare:*` or `bun:*`, calls `require`, or references `Buffer`, `window`, `document` or `localStorage`.
5. THE Crypto_Package SHALL run the Boundary_Check as an equivalent of `packages/protocol/scripts/check-boundaries.ts`; whether the script is reused or copied is a design matter.
6. THE Boundary_Check SHALL be Node-only tooling outside `src` and SHALL NOT be imported by `src`.
7. THE Crypto_Package SHALL include a test that runs the Boundary_Check on a sample file containing each forbidden construct and asserts that each is reported, and on the real `src` tree and asserts that it passes.
8. THE Crypto_Package SHALL bundle the same source for Node, Workers and browsers, with no conditional export or runtime switch that changes behavior.
9. THE Crypto_Package SHALL write no key material, secret, signature input or payload content to any log, error message or exception message (SI-12).

### Requirement 3: Failure model (what returns false, what returns a Result_Object, what throws)

**User Story:** As a verifier author, I want a precise rule for how each function fails, so that a hostile frame can never crash a relay or node and a bug in trusted code is never hidden.

Implements §20 row 2 R3 (`verify()` returns false), §12.1 SI-3, §6.9 (`E_BAD_SIGNATURE`, `E_SCHEMA_INVALID`).

#### Acceptance Criteria

1. THE verification functions (envelope verification, `WS_Auth_Payload` verification, `WraithSig_Payload` verification, HMAC verification) SHALL accept parameters typed `unknown` at runtime and SHALL return a Verify_Result for every input.
2. IF a verification function receives malformed input (a value of the wrong type, a malformed key, a malformed signature, malformed base64url, an Envelope that is not an object, a missing member, an `alg` other than `ES256`, a Non_JSON_Value inside the scope), THEN THE function SHALL return `false` and SHALL NOT throw, reject, or leave a rejected promise.
3. IF WebCrypto is unavailable or a WebCrypto call fails inside a verification function, THEN THE function SHALL return `false` (fail closed) and SHALL NOT throw.
4. THE functions that import a key or decode a value from untrusted input (public key import, private key import, base64url decoding) SHALL return a Result_Object and SHALL NOT throw. The `code` of a failed import SHALL be `E_SCHEMA_INVALID`.
5. THE functions that take only trusted values built by program code (canonicalization, hashing, signing, key generation, payload builders, `requestHash`, HMAC computation) SHALL treat a Non_JSON_Value or an unavailable WebCrypto as a Programmer_Error and SHALL throw an error whose class is exported by the Crypto_Package.
6. THE thrown errors and failed Result_Objects of the Crypto_Package SHALL contain a stable machine-readable reason and SHALL NOT contain key material, secrets, signature inputs or payload content (SI-12).
7. THE Crypto_Package SHALL leave the mapping from `false` to `E_BAD_SIGNATURE`, `E_REPLAY` or any other `ErrorCode` response to the Verifier.
8. THE Crypto_Package SHALL include a test that feeds each verification function at least these inputs and asserts `false` and no exception: `undefined`, `null`, a number, a string, an empty object, an array, an object with a cyclic reference, a scope with `meta` missing, a scope with a `bigint`, a signature that is not a string, a signature of 63 and 65 decoded bytes, a signature with `=` padding, a public key with `d`, a public key on another curve, and a public key with a missing `x`.

### Requirement 4: Encoding, hashing and randomness helpers

**User Story:** As a developer of any component, I want one base64url, one SHA-256 and one random-bytes helper, so that no component re-implements encodings that must match byte for byte.

Implements §20 row 2 (SHA-256), §6.1 (Base64url `sig.value` and `requestHash`), §6.7 (`bodySha256`), §3.4 (random 128-bit secret, `SHA-256(signPub)` fingerprint input).

#### Acceptance Criteria

1. THE Crypto_Package SHALL export a Base64url encoder from bytes to string that writes no `=` padding and uses only the characters `A-Z a-z 0-9 - _`.
2. THE Crypto_Package SHALL export a strict Base64url decoder that returns a Result_Object.
3. IF the input of the decoder contains `=`, `+`, `/`, whitespace or any character outside the Base64url alphabet, or has a length whose remainder modulo 4 is 1, or has non-zero unused trailing bits, THEN THE decoder SHALL return `{ok: false, code: "E_SCHEMA_INVALID"}`.
4. FOR ALL byte arrays, decoding the Base64url encoding SHALL produce the original bytes (round trip), and FOR ALL strings that the decoder accepts, encoding the decoded bytes SHALL produce the original string (canonical form, no second spelling of the same bytes).
5. THE Crypto_Package SHALL export a SHA-256 function from bytes to a 32-byte digest and a variant that returns the digest as Base64url, both computed with WebCrypto.
6. THE Crypto_Package SHALL export a UTF-8 encoder from string to bytes that rejects a string with a lone surrogate instead of replacing it with U+FFFD.
7. THE Crypto_Package SHALL export a function `randomBytes(n)` that returns `n` bytes from `crypto.getRandomValues`, and SHALL NOT use `Math.random`.
8. THE Crypto_Package SHALL include test vectors for Base64url (empty input, 1, 2 and 3 byte inputs, input with bytes that map to `-` and `_`) and for SHA-256 (the empty input and `abc`) in the Known_Answer_Vectors.

### Requirement 5: Key generation, JWK import and export, extractability

**User Story:** As an author of the node, the PWA and the pairing flow, I want to create, import and export P-256 keys in JWK form, so that keys can be stored by their owners and public keys can travel in the roster.

Implements §20 row 2 ("key import/export JWK"), §6.2 (`RosterEntry.signPub: JWK`), §6.3 (`node.key` is a JWK file), §3.4 (key fingerprint, compressed `signPub`), §4.5 (non-extractable device key); SI-12.

#### Acceptance Criteria

1. THE Crypto_Package SHALL export a function that generates an ECDSA P-256 Key_Pair with WebCrypto, with usages `sign` for the private key and `verify` for the public key.
2. THE key generation function SHALL take an option that sets whether the private key is extractable, and SHALL create the public key as always exportable. The default for the private key SHALL be non-extractable. The node generates once with an extractable private key, exports the Private_JWK for `node.key` (written by S-node-core), and re-imports it as non-extractable for normal signing.
3. THE Crypto_Package SHALL export a function that exports a public key as a Public_JWK containing exactly `kty` (`EC`), `crv` (`P-256`), `x` and `y`.
4. WHERE the private key was created extractable, THE Crypto_Package SHALL export a function that exports it as a Private_JWK.
5. IF a private key is not extractable, THEN THE private-key export function SHALL fail as a Programmer_Error (Requirement 3 criterion 5).
6. THE Crypto_Package SHALL export a function that imports a Public_JWK as a `verify` key, and a function that imports a Private_JWK as a `sign` key with an extractable flag chosen by the caller.
7. IF a value passed to the public key import fails the `JWK` schema of the Protocol_Package, or has `kty` other than `EC`, `crv` other than `P-256`, a `d` member, `x` or `y` that does not decode to 32 bytes, or a point that is not on the curve, THEN THE import function SHALL return `{ok: false, code: "E_SCHEMA_INVALID"}` and SHALL NOT throw.
8. IF a value passed to the private key import lacks `d`, or has `d` that does not decode to 32 bytes, or has any defect listed in criterion 7, THEN THE import function SHALL return `{ok: false, code: "E_SCHEMA_INVALID"}` and SHALL NOT throw.
9. THE public key import SHALL ignore the members `use`, `key_ops`, `ext` and `alg` of the input and SHALL NOT let them change the usages of the imported key.
10. THE Crypto_Package SHALL derive the public JWK from a private JWK without exposing `d`.
11. FOR ALL generated Key_Pairs, exporting the public key, importing it, and exporting it again SHALL produce an equal Public_JWK (round trip), and a signature made with the private key SHALL verify under the re-imported public key.
12. THE Crypto_Package SHALL export a key fingerprint function for a Public_JWK that returns the SHA-256 digest (32 bytes) of the 33-byte compressed SEC1 P-256 point of the key (§3.4, C78). Grouping and display of the first 8 bytes belong to S-pairing-trust, and the fingerprint is never used to verify.
13. THE Crypto_Package SHALL export `publicKeyToCompressed(jwk)` and `publicKeyFromCompressed(bytes)` for the 33-byte compressed SEC1 P-256 point (§3.4, C78), so that the `WRP1-` payload, the Pairing_HMAC and the fingerprint use one conversion; `publicKeyFromCompressed` SHALL return a Result_Object with `E_SCHEMA_INVALID` for a wrong length, a wrong prefix byte, a coordinate that is not on the curve, or any other malformed input, and SHALL NOT throw.
14. THE Crypto_Package SHALL NOT write a key to disk, IndexedDB, a keychain or any other storage, and SHALL NOT log a key.

### Requirement 6: JCS canonicalization (RFC 8785)

**User Story:** As a developer of signing and verification code on three runtimes, I want one canonicalizer with the RFC 8785 behavior, so that the same JSON value gives the same bytes everywhere.

Implements §20 row 2 R1, §6.1 (RFC 8785), §21.1 PBT #14 (JCS part), P0-D2.

#### Acceptance Criteria

1. THE Crypto_Package SHALL export a canonicalizer that takes a JSON_Value and returns its JCS serialization as a string, and a variant that returns the Canonical_Bytes.
2. THE canonicalizer SHALL write no whitespace between tokens.
3. THE canonicalizer SHALL sort the members of every object by the UTF-16 code units of the property names, in ascending order, at every nesting level, and SHALL NOT use locale-aware comparison.
4. THE canonicalizer SHALL serialize numbers with the ECMAScript `Number::toString` algorithm required by RFC 8785 section 3.2.2.3, so that `1e21` is written `1e+21`, `1.0` is written `1`, `0.000001` is written `0.000001` and `1e-7` is written `1e-7`.
5. THE canonicalizer SHALL write `-0` as `0`.
6. IF the input contains `NaN`, `Infinity` or `-Infinity`, THEN THE canonicalizer SHALL throw a Programmer_Error.
7. IF the input contains a `bigint`, THEN THE canonicalizer SHALL throw a Programmer_Error, because an integer outside the range exactly representable by a double has no JCS form.
8. THE canonicalizer SHALL serialize strings with the escaping required by RFC 8785 section 3.2.2.2: the two-character escapes `\b \t \n \f \r \" \\`, the form `\u00xx` in lower-case hexadecimal for the other control characters below U+0020, and every other character as itself in UTF-8 (including U+007F and characters above U+FFFF, with no `\u` escape and no escaping of `/`).
9. IF a string or a property name contains a lone UTF-16 surrogate, THEN THE canonicalizer SHALL throw a Programmer_Error, because such a string has no UTF-8 form (RFC 8785 requires I-JSON input).
10. IF the input contains `undefined`, a function, a symbol, or any other Non_JSON_Value, at any depth, as an object property value or as an array element, THEN THE canonicalizer SHALL throw a Programmer_Error and SHALL NOT omit or convert the value.
11. THE canonicalizer SHALL treat the property name `__proto__` as an ordinary property name when it is an own property of the input.
12. THE canonicalizer SHALL NOT mutate its input and SHALL return the same output for a deeply equal input regardless of the property insertion order of the input objects.
13. FOR ALL JSON_Values produced by `JSON.parse` of any valid JSON text, the canonical output SHALL parse back with `JSON.parse` to a deeply equal value (round trip).
14. THE canonicalizer SHALL produce the expected output for every JSON_Value in the Known_Answer_Vectors, which SHALL include the examples of RFC 8785 Appendix B (number serialization) and section 3.2.3 (property sorting), a nested object with keys that differ in UTF-16 order from code point order (for example U+FF5E before an astral character), a string with U+2028 and U+2029, an empty object, an empty array and deeply nested arrays.
15. WHERE the Known_Answer_Vectors are used, THE Crypto_Package SHALL store expected bytes as hexadecimal text, not as a string, so that no runtime re-encodes them.
16. THE canonicalizer SHALL be an in-house implementation in the Crypto_Package (§16, Crypto row) and SHALL add no dependency.

### Requirement 7: Signature scope and ES256 signing

**User Story:** As a developer of any signing component (PWA, node, watch, relay for the challenge), I want one function that signs exactly `{v, meta, body}`, so that a relay-added field can never change what is signed.

Implements §20 row 2 R2, §6.1 (Signature scope), §6.2 (`Sig`), SI-4.

#### Acceptance Criteria

1. THE Crypto_Package SHALL sign the Canonical_Bytes of the Signature_Scope of an Envelope, where the Signature_Scope is obtained with `signatureScope` of the Protocol_Package and is exactly `{v, meta, body}`.
2. THE Signature_Scope SHALL exclude `sig` and `relay` (R2 of §20 row 2, SI-4).
3. WHEN a signing function is called with an Envelope that has `sig` or `relay` members, THE signing function SHALL ignore those members and SHALL NOT read their content.
4. THE signing function SHALL take a private signing key and a `MemberId` and SHALL return a `Sig` with `by` equal to that `MemberId`, `alg` equal to `ES256` and `value` equal to the Base64url of the ES256 signature in the Signature_Encoding.
5. THE signing function SHALL NOT validate the Envelope against the Protocol_Package schemas; validation belongs to `parseRaw` and the producer of the Envelope.
6. IF the Signature_Scope contains a Non_JSON_Value, or `body` is absent, THEN THE signing function SHALL throw a Programmer_Error (Requirement 3 criterion 5).
7. THE Crypto_Package SHALL export a lower-level function that signs given bytes with a private key and returns the signature bytes, and a matching function that verifies given bytes (Requirement 8 criterion 10). The Envelope, `WS_Auth_Payload` and `WraithSig_Payload` functions SHALL be built on these two functions.
8. THE signing function SHALL produce a signature of exactly 64 bytes (raw IEEE P1363 `r||s`) before Base64url encoding, and SHALL NOT enforce low-S (Signature_Encoding, §6.1).
9. THE Crypto_Package SHALL NOT mutate the Envelope passed to a signing function.
10. FOR ALL Envelopes and all generated Key_Pairs, signing and then verifying under the matching public key SHALL return `true` (P0-D3 round trip, tested by Requirement 13).

### Requirement 8: Verification

**User Story:** As a verifier author, I want one function that says whether a signature matches the signed bytes of a received message and never throws, so that no malformed frame can cause an exception or a false accept.

Implements §20 row 2 R3, §6.1, §12.1 SI-3, SI-4, SI-5 (statement of limits), §21.1 PBT #6 (crypto part).

#### Acceptance Criteria

1. THE Crypto_Package SHALL export `verify` that takes a Signature_Scope input (an Envelope or the Signed_Member of `parseRaw`), a `Sig` and a public key (a Public_JWK or a verify `CryptoKey`) and SHALL return a promise of a Verify_Result.
2. WHEN the caller verifies a frame that was parsed with `parseRaw`, THE Verifier SHALL pass the Signed_Member of the parse result, so that fields that the typed parse strips from `body` are still covered by the signature. THE Crypto_Package SHALL document this rule in the doc comment of `verify`.
3. THE `verify` function SHALL derive the scope with `signatureScope` and SHALL NOT read any member of its input other than `v`, `meta` and `body` (SI-4: `relay.*` is never used for a security decision; `sig` is supplied as a separate parameter).
4. IF any value in `meta` or `body` of the verified scope differs from the value that was signed (a changed, added, removed or renamed member at any depth, a changed array element, a changed array length, a changed string, number, boolean or `null`), THEN `verify` SHALL return `false`.
5. IF the signature bytes differ in any bit from the signature produced by the signer, THEN `verify` SHALL return `false`.
6. IF `v` is not `1`, THEN `verify` SHALL return `false`.
7. IF `sig.alg` is not exactly the string `ES256`, THEN `verify` SHALL return `false` before any WebCrypto call.
8. WHEN only `relay` or only `sig.by` of the input differs from the signed message, THE result of `verify` SHALL be unchanged. (The binding of `sig.by` to a roster entry is the Verifier's duty in S-node-core and S-relay-core; the Crypto_Package copies `sig.by` into the `Sig` it returns and reads it nowhere else.)
9. IF the public key is not the public key of the signer, THEN `verify` SHALL return `false`.
10. THE Crypto_Package SHALL export a byte-level function `verifyBytes(bytes, signature, publicKey)` that returns a Verify_Result under the same never-throws rule and is used by `verify`.
11. THE `verify` function SHALL be stateless: it SHALL NOT store, cache or check `meta.id`, `ts`, nonces, roster data, revocation data or owner pins. A `true` result SHALL NOT mean that the message is fresh, unrevoked, authorized, or from a roster member (SI-3 and SI-5 stay with the Verifier).
12. THE Crypto_Package SHALL NOT fetch, request or accept a public key from the relay on its own; the caller passes the public key it obtained from the owner-signed roster pinned on the node (SI-3).
13. THE `verify` function SHALL NOT throw for any input (Requirement 3 criteria 1 to 3).
14. THE verification of the owner signature of `roster.update` and other `owner`-signed messages SHALL use the same `verify` function with the pinned owner public key; the Crypto_Package SHALL NOT contain a roster-specific verification path.

### Requirement 9: requestHash

**User Story:** As the author of the approval flow, I want one function that binds an `approval.respond` to the exact `approval.request` a user saw, so that the node can detect a different version of the request.

Implements §20 row 2 R4, §6.1 (`requestHash`), SI-4, §21.1 PBT #6 (`requestHash` mismatch, crypto part).

#### Acceptance Criteria

1. THE Crypto_Package SHALL export `requestHash(envelope)` that returns the Base64url (no padding, 43 characters) of the SHA-256 digest of the Canonical_Bytes of `signatureScope(envelope)`, that is of JCS `{v, meta, body}`.
2. THE `requestHash` function SHALL compute the digest over the same Canonical_Bytes that the signing function signs for that Envelope.
3. THE `requestHash` function SHALL be defined for an `approval.request` Envelope (the use in §6.1) and SHALL be total over every Envelope that `parseRaw` accepts, whatever its `meta.type`, and SHALL NOT check `meta.type`.
4. WHEN `sig` or `relay` of the Envelope changes, THE result of `requestHash` SHALL be unchanged.
5. WHEN any value in `meta` or `body` of the Envelope changes, THE result of `requestHash` SHALL change.
6. THE `requestHash` function SHALL accept the Signed_Member of `parseRaw` as well as an Envelope.
7. IF the scope contains a Non_JSON_Value, THEN `requestHash` SHALL throw a Programmer_Error. This cannot happen for a value that `JSON.parse` produced.
8. THE Crypto_Package SHALL export a function that compares two Request_Hash values in constant time over their decoded bytes and returns `false` for any malformed input. It SHALL NOT throw.
9. THE Crypto_Package SHALL include in the Known_Answer_Vectors at least one `approval.request` Envelope with its Canonical_Bytes (hex), its digest (hex) and its Request_Hash.

### Requirement 10: WebSocket authentication and WraithSig payloads

**User Story:** As an author of the relay handshake, the node, the PWA and the watch client, I want the two non-envelope signed payloads built and checked in one place, so that the relay and every client sign and verify identical bytes.

Implements §6.3 (ws-auth challenge), §6.7 (`WraithSig`), §20 row 2 R1 (JCS identity across runtimes). The builders live in the Crypto_Package (§6.7); the header text format and the window and nonce checks stay with the relay.

#### Acceptance Criteria

1. THE Crypto_Package SHALL export a builder for the WS_Auth_Payload from `space`, `member` and `nonce`, producing `{v: 1, purpose: "ws-auth", space, member, nonce}` with `v` the number `1` and `purpose` the string `ws-auth`.
2. THE Crypto_Package SHALL export a function that signs the Canonical_Bytes of a WS_Auth_Payload with ES256 and returns the Base64url signature, and a function that verifies it, following the never-throws rule of Requirement 3.
3. THE Crypto_Package SHALL treat `space`, `member` and `nonce` as opaque strings and SHALL NOT interpret the nonce; issuing the nonce, its 60 second lifetime and single use belong to S-relay-core.
4. THE Crypto_Package SHALL export a builder for the WraithSig_Payload from `member`, `ts`, `nonce`, `method`, `path`, `query` and `bodySha256`, producing `{v: 1, member, ts, nonce, method, path, query, bodySha256}`.
5. WHEN the request has no body, THE builder SHALL set `bodySha256` to the empty string `""` (§6.7: `""` if none).
6. WHEN the request has a body, THE builder SHALL set `bodySha256` to the Base64url (no padding) of the SHA-256 of the raw body bytes (§6.7, C78). The empty string in criterion 5 is not the hash of an empty body.
7. THE builder SHALL encode the other fields as follows (§6.7, C78): `ts` as a JSON integer (unix ms), `nonce` as the ULID string, `method` in upper case as sent, `path` as the raw request path without the query, and `query` as the raw query string without `?` (`""` if none), not decoded and not re-sorted.
8. THE Crypto_Package SHALL export a function that signs the Canonical_Bytes of a WraithSig_Payload with ES256 and returns the Base64url signature, and a function that verifies it, following the never-throws rule of Requirement 3.
9. THE verification functions of this requirement SHALL compare the payload fields they are given with the fields of the signed payload only through the Canonical_Bytes and SHALL NOT check clock windows, nonce reuse or roster membership (S-relay-core; SI-5).
10. A signature over one of the three payload kinds (Envelope scope, WS_Auth_Payload, WraithSig_Payload) SHALL NOT verify as either of the other two kinds, because their member sets differ. THE Crypto_Package SHALL include a test that signs one sample of each kind and asserts that all six cross-verifications return `false`.
11. THE Crypto_Package SHALL export no function that parses or formats the `Authorization: WraithSig …` header.
12. THE Known_Answer_Vectors SHALL contain one WS_Auth_Payload and one WraithSig_Payload (with a body and without a body) with their Canonical_Bytes in hexadecimal.

### Requirement 11: HMAC-SHA-256 and the pairing HMAC

**User Story:** As the author of pairing on the owner device and on the joining member, I want the HMAC primitives and the Pairing_HMAC computed in one place, so that both sides get the same bytes and a relay that swaps keys or escalates caps makes pairing fail.

Implements §20 row 2 ("HMAC"), §3.4 (pairing HMAC, Pairing payload, key fingerprint), §6.2 (`pair.complete{ownerPub, rosterEntries, hmac}`), `E_PAIR_HMAC_MISMATCH` (§6.9). The input framing is normative in §3.4 (C78).

#### Acceptance Criteria

1. THE Crypto_Package SHALL export an HMAC-SHA-256 function that takes a secret as bytes and a message as bytes and returns the 32-byte tag, with the secret imported as a raw WebCrypto HMAC key.
2. THE Crypto_Package SHALL export an HMAC verification function that compares the tag with WebCrypto `verify` (constant time in the runtime), takes `unknown` parameters, returns a Verify_Result, and never throws (Requirement 3).
3. THE Crypto_Package SHALL export a function that creates a Pairing_Secret of 16 random bytes (128 bits) with `randomBytes`, so that the node, browser, app and watch use one generator.
4. IF the secret passed to an HMAC computation function (HMAC-SHA-256 or Pairing_HMAC) is empty, THEN THE function SHALL throw a Programmer_Error, because computation takes trusted program-built input (Requirement 3 criterion 5). IF the secret passed to an HMAC verification function is empty, THEN THE function SHALL return `false` and SHALL NOT throw (Requirement 3 criteria 1 to 3).
5. THE Crypto_Package SHALL export a function that computes the Pairing_HMAC from `secret`, `ownerPub`, `spaceId`, `rosterVersion` and `rosterEntries`.
6. THE Pairing_HMAC function SHALL sort `rosterEntries` by `memberId` in ascending UTF-16 code unit order itself, so that callers cannot forget to sort or sort differently.
7. THE Pairing_HMAC function SHALL compute `SHA-256(JCS(sorted rosterEntries))` using the canonicalizer of Requirement 6.
8. THE Pairing_HMAC function SHALL build the HMAC message as the concatenation `ownerPub‖spaceId‖rosterVersion‖digest` with the byte framing of §3.4 (C78): `ownerPub` as the 33-byte compressed SEC1 P-256 point, `spaceId` as UTF-8 bytes, `rosterVersion` as an 8-byte big-endian unsigned integer, and the digest as 32 raw bytes, in that order, and SHALL produce the same tag for one entry (single member) and for two entries (Wraith.app Join, one HMAC over both entries).
9. THE Crypto_Package SHALL export a Pairing_HMAC verification function that recomputes the tag and compares it in constant time, and returns `false` for any malformed input.
10. IF any of `ownerPub`, `spaceId`, `rosterVersion` or any member of `rosterEntries` (`memberId`, `signPub`, `caps`, `hostPriority`, `label`, `addedAt`, `kind`) differs between the tagging side and the verifying side, THEN THE Pairing_HMAC verification SHALL return `false`.
11. THE Crypto_Package SHALL NOT implement the `WRP1-` payload, base32, CRC-16, ticket handling, owner-key pinning or the check that a member's own roster entry holds its own key and requested caps; these belong to S-pairing-trust, which maps a `false` result to `E_PAIR_HMAC_MISMATCH`.
12. THE Crypto_Package SHALL NOT generate a Pairing_Secret anywhere except by the function of criterion 3, and SHALL NOT include the secret in an error message (SI-12).
13. THE Known_Answer_Vectors SHALL contain the HMAC-SHA-256 test vectors of RFC 4231 (at least test cases 1, 2 and 6) and one Pairing_HMAC with one entry and one with two entries.
14. THE Crypto_Package SHALL include a test that an empty secret makes each HMAC computation function throw a Programmer_Error and makes each HMAC verification function return `false` without throwing.
15. THE Pairing_HMAC tag SHALL travel as Base64url (no padding) and THE Pairing_HMAC verification SHALL compare the decoded tag in constant time (§3.4).

### Requirement 12: P0-D2 gate — JCS byte-equality on Node and in the Workers pool

**User Story:** As the owner of the P0 definition of done, I want evidence that JCS gives the same bytes on Node and in the Workers runtime, so that a Worker relay and a node never disagree on signed bytes.

Implements P0-D2 (§18.1), §21.1 PBT #14 (JCS part: Node and Worker), §20 row 2 R1.

#### Acceptance Criteria

1. THE Crypto_Package SHALL include a JCS byte-equality test suite that runs the Known_Answer_Vectors of Requirement 6 and a PBT that compares the canonicalizer output with an independent reference (the RFC 8785 examples and a second implementation used only in tests) on generated JSON_Values.
2. THE Crypto_Package SHALL run that suite in a `node` Vitest project and in a `workers` Vitest project that uses `@cloudflare/vitest-pool-workers`.
3. THE P0-D2 evidence SHALL exist on both runtimes: a pass on Node and a pass in the Workers_Pool. P0-D2 SHALL NOT be marked `pass` in `docs/PHASE-STATUS.md` when only one runtime has run.
4. THE Crypto_Package spec SHALL own the resolution of the compatibility of the root `vitest` 5.0.5 with the `@cloudflare/vitest-pool-workers` release; S-protocol task 19.1 reuses the result and SHALL NOT resolve it again.
5. WHEN the Crypto_Package tasks pin the `@cloudflare/vitest-pool-workers` version, THEN THE tasks SHALL verify, by running the Workers_Pool test suite once, that the pinned pool release works with the root `vitest` version, and SHALL pin every involved version exactly (the pool tracks specific Vitest versions, so the root `vitest` and the pool may need pinning together).
6. IF the root `vitest` 5.0.5 and the `@cloudflare/vitest-pool-workers` release are incompatible, THEN THE tasks SHALL record in `docs/PHASE-STATUS.md` that the Workers run of P0-D2 is `pending`, with the reason (the versions tried and the error), SHALL keep the task open, and SHALL NOT drop the Workers run and SHALL NOT mark P0-D2 `pass`.
7. IF the incompatibility of criterion 6 occurs, THEN THE tasks SHALL NOT adopt a fallback automatically; the options in order of preference are (a) pin `vitest` and the pool together to a compatible release pair, (b) run the Workers project from a package-local `vitest` version in `packages/crypto` only, (c) run the same test files in `workerd` through Miniflare from a script and record a log or JSON file. THE tasks SHALL NOT adopt one without an owner decision recorded in `docs/DECISIONS-PENDING.md`, because (c) is not literally `@cloudflare/vitest-pool-workers`.
8. WHEN the compatibility is resolved, THE Crypto_Package SHALL write the result (the pinned versions, the Vitest config that works, the command) to `docs/PHASE-STATUS.md` or the task notes so that S-protocol task 19.1 can reuse it.
9. THE Workers_Pool tests SHALL use no Node-only API and the suite SHALL be written so that the same test files run in both projects (a Node-only test is named `*.node.test.ts`, as in S-protocol).
10. THE P0-D2 suite SHALL be listed in the `pnpm -r test` run of CI and SHALL be non-empty (P0-D1).

### Requirement 13: P0-D3 gate — property-based tests at 1,000 runs, PBT #6 and #14 crypto parts

**User Story:** As the owner of the P0 definition of done, I want property tests that prove sign then verify works and that any change to the signed content is rejected, so that the signature scheme is demonstrably sound before anything is built on it.

Implements P0-D3 (§18.1), §21.1 PBT #6 (verifier-level mutate-any-byte part that belongs to crypto, relay-has-no-effect part) and PBT #14 (JCS part), §12.1 SI-4.

#### Acceptance Criteria

1. THE Crypto_Package test configuration SHALL define one named constant `CRYPTO_PBT_RUNS = 1000`.
2. THE value `1000` of CRYPTO_PBT_RUNS SHALL be higher than `PBT_MIN_RUNS = 500` of S-protocol. This is intentional (P0-D3 states 1,000 runs); the Crypto_Package SHALL define its own constant and SHALL NOT import `PBT_MIN_RUNS` from the Protocol_Package.
3. EVERY PBT of the Crypto_Package SHALL run with at least CRYPTO_PBT_RUNS runs, and THE Crypto_Package SHALL include a test that fails when a PBT in its test folder is configured with a smaller run count or with a literal instead of the constant.
4. THE Crypto_Package SHALL include a PBT "sign then verify": FOR ALL generated Envelopes of every MessageType and all generated Key_Pairs, `verify(sign(envelope))` under the matching public key SHALL return `true` (P0-D3). "Every MessageType" means every type in the protocol registry at the time the test runs; coverage grows as S-protocol P1 lands. THE test SHALL derive the type list from the registry (`MESSAGE_TYPES`) and SHALL NOT hard-code it.
5. THE Crypto_Package SHALL include a PBT "mutate any value": FOR ALL signed Envelopes and all mutations of one value in `meta` or `body` (changed leaf, added member, removed member, renamed member, changed array element, added or removed array element, type change), `verify` SHALL return `false`. A mutation SHALL be generated so that the resulting JSON value differs from the original; a change that leaves the Canonical_Bytes identical (reordered object members, different spelling of the same number in the raw text) is not a mutation.
6. THE Crypto_Package SHALL include a PBT "mutate any byte": FOR ALL signed byte strings and every single-bit or single-byte change of the Canonical_Bytes, `verifyBytes` SHALL return `false`.
7. THE Crypto_Package SHALL include a PBT "mutate the signature": FOR ALL signatures and every single-bit change of the 64 signature bytes, and every change of the encoded `sig.value` text to another string, `verify` SHALL return `false`.
8. THE Crypto_Package SHALL include a PBT "relay and sig.by have no effect" (PBT #6, SI-4): FOR ALL signed Envelopes and all replacement `relay` objects, `verify`, `requestHash` and the Canonical_Bytes of the scope SHALL be unchanged.
9. THE Crypto_Package SHALL include a PBT "wrong key": FOR ALL signed Envelopes and a second generated Key_Pair, `verify` under the second public key SHALL return `false`.
10. THE Crypto_Package SHALL include a PBT "verify never throws": FOR ALL arbitrary values (`fc.anything`) for the scope, the signature and the key, every verification function SHALL resolve to a boolean and SHALL NOT throw.
11. THE Crypto_Package SHALL include a PBT for `requestHash` (Requirement 9) and for Base64url (Requirement 4 criterion 4).
12. THE Crypto_Package SHALL include a PBT "JCS identical bytes" (PBT #14, JCS part): FOR ALL JSON_Values, the canonicalizer output SHALL equal the independent reference output, SHALL be independent of property insertion order, and SHALL be idempotent (canonicalizing the parse of the output gives the same output).
13. THE PBTs of this requirement SHALL generate Envelopes with the builders and arbitraries exported by `@wraith/protocol/testing` and `@wraith/protocol/testing/arbitraries`, and SHALL NOT redeclare message shapes. Wherever a PBT covers "every MessageType" (criteria 4 and 5), the covered types are those in the protocol registry at the time the test runs, derived from `MESSAGE_TYPES` and not hard-coded; coverage grows as S-protocol P1 lands.
14. THE PBTs SHALL run in the `node` project and, where they use only portable APIs, in the `workers` project (Requirement 12).
15. THE Crypto_Package SHALL include a test with the Known_Answer_Vectors that verifies a fixed signature under a fixed Public_JWK for a fixed Envelope, so that an independent implementation (the watch with `@noble/curves`, a Rust helper) can check interoperability with the same file.
16. WHERE a browser test project is configured (added in P1 as a Vitest browser-mode project, or as an S-pwa-shell test that loads the same vectors file; it is not part of P0-D2), THE Crypto_Package SHALL run the Known_Answer_Vectors of Requirement 6 and the signature vector of criterion 15 in it.
17. THE tests of this requirement SHALL be part of `pnpm -r test` on CI for Linux and macOS and SHALL be non-empty (P0-D1, P0-D3).

### Requirement 14: Traceability and spec boundaries

**User Story:** As a spec author for the other specs, I want this spec's boundaries and decisions recorded, so that no behavior is implemented twice or left unowned.

Implements §20 (spec decomposition), §20 intro rules, §22.1 (human decisions are recorded, not guessed), SI-3, SI-4, SI-5.

#### Acceptance Criteria

1. THE Crypto_Package SHALL implement only canonicalization, hashing, encoding, key handling, signing, verification of bytes, the payload builders of Requirement 10 and the HMAC primitives of Requirement 11, and SHALL leave roster, pinning, replay, caps, pairing flow, key storage and relay behavior to the specs named in the Boundary list.
2. THE Crypto_Package SHALL NOT use `relay.*` for any decision (SI-4).
3. THE Crypto_Package SHALL NOT provide replay protection and SHALL NOT claim that a `true` result of verification is evidence of freshness (SI-5).
4. THE Crypto_Package SHALL NOT decide which public key is trusted for a message; that decision is made against the owner-signed roster pinned on the node (SI-3).
5. WHEN an item in §6 is ambiguous or contradictory, THE design phase SHALL NOT resolve it by guessing, and SHALL record the question for a human decision in `docs/DECISIONS-PENDING.md`.
6. THE SHALL NOT statements of this document that cite SI-3, SI-4, SI-5 and SI-12 SHALL NOT be weakened, removed or edited by the agent loop (§22).
7. THE Crypto_Package tasks SHALL map every task to a requirement of this document and, where applicable, to P0-D1, P0-D2 or P0-D3.

## Resolved decisions

Resolved by the owner, 2026-11-12.

Owner constraints given with the request for this spec (binding on the design):

1. **Dependency on S-protocol.** `packages/crypto` depends on `@wraith/protocol` and redeclares none of it (§20 row 2, depends on 1). Affects Requirements 1 and 14.
2. **WebCrypto only.** No `node:crypto`, no `Buffer`; the package runs unchanged on Node, Workers and browsers; a Boundary_Check equivalent to the one in `packages/protocol` applies; the dependency list is limited to `@wraith/protocol`. Affects Requirements 1 and 2.
3. **P0-D2 and vitest compatibility.** JCS byte-equality must pass on Node and in `@cloudflare/vitest-pool-workers`. This spec owns resolving the compatibility of root `vitest` 5.0.5 with the pool; S-protocol task 19.1 reuses the result. If incompatible, the Workers run is recorded as pending in `docs/PHASE-STATUS.md` with the reason and P0-D2 is not passed. Affects Requirement 12.
4. **P0-D3 at 1,000 runs.** Sign then verify round trip and mutate-any-byte then reject run as PBTs with `CRYPTO_PBT_RUNS = 1000`, which is higher than S-protocol's `PBT_MIN_RUNS = 500`. Affects Requirement 13.
5. **Failure model.** `verify` and every verification function return `false` on bad input and never throw. Untrusted-input decoding and key import return a Result_Object with `E_SCHEMA_INVALID` and never throw. Key generation, signing, canonicalization, HMAC computation and other functions fed only by trusted program values throw a Programmer_Error. Affects Requirements 3 and 11.
6. **requestHash.** `requestHash(envelope)` is Base64url of SHA-256 of JCS `{v, meta, body}` (SI-4: excludes `sig` and `relay`), defined for `approval.request` and total over any Envelope, built on `signatureScope`. Affects Requirement 9.

Decisions on the 16 points that §6 and §20 left open. The owner accepted every recommended default as written.

1. **JCS implementation.** Own RFC 8785 implementation in `packages/crypto`, no dependency; compared in tests with an independent reference. Affects Requirements 1, 6 and 12.
2. **ES256 signature encoding.** Now normative in §6.1 (architecture v4.1.6, C78): raw IEEE P1363 `r||s`, 64 bytes, Base64url without padding, low-S not enforced. Affects Glossary (Signature_Encoding) and Requirements 7 and 13.
3. **Key extractability.** `generateKeyPair({extractablePrivate})` defaults to `false`; the node generates once extractable, exports the Private_JWK for `node.key`, then re-imports it non-extractable; the public key is always exportable. Affects Requirement 5.
4. **HMAC algorithm, secret and framing.** Now normative in §3.4 (architecture v4.1.6, C78): HMAC-SHA-256, 16-byte secret generated by the Crypto_Package with `getRandomValues`, tag as Base64url compared in constant time, framing `ownerPub` (33-byte compressed point) ‖ `spaceId` (UTF-8) ‖ `rosterVersion` (8-byte big-endian) ‖ digest (32 raw bytes), `rosterEntries` sorted by UTF-16 code units of `memberId`. Affects Requirement 11.
5. **Browser run of R1.** Browsers are not part of P0-D2; the portable Known_Answer_Vectors file is the contract; the browser check is added in P1 as a Vitest browser-mode project or an S-pwa-shell test that loads the same vectors. Affects Requirement 13 criterion 16.
6. **Fallback if root `vitest` and the pool are incompatible.** No fallback is adopted automatically; record the Workers run as pending, keep the task open, and ask the owner; options in order: (a) pin `vitest` and the pool together, (b) package-local `vitest` in `packages/crypto`, (c) `workerd` through Miniflare from a script. Affects Requirement 12 criteria 6 and 7.
7. **Key fingerprint and compressed point.** Now normative in §3.4 (architecture v4.1.6, C78): the fingerprint is `SHA-256(signPub)` over the 33-byte compressed point, first 8 bytes shown as 4 groups for human comparison only; the `WRP1-` payload and the Pairing_HMAC use the same 33-byte compressed point. The Crypto_Package owns `publicKeyToCompressed`, `publicKeyFromCompressed` and the fingerprint function; grouping and display belong to S-pairing-trust. Affects Requirements 5 and 11.
8. **Payload builders location.** The WS-auth and WraithSig payload builders live in the Crypto_Package (§6.7 says so too); the header format and the clock, nonce and roster checks stay with S-relay-core. Affects Requirement 10.
9. **WraithSig field encodings.** Now normative in §6.7 (architecture v4.1.6, C78): `ts` JSON integer, `nonce` ULID string, `method` upper-case, `path` and `query` raw, `bodySha256` Base64url of the raw body or `""` when there is no body. Affects Requirement 10.
10. **SHA-256 helper exposure.** `sha256(bytes)` and `sha256Base64Url(bytes)` are exported publicly. Affects Requirement 4.
11. **`sig.by` binding.** The Crypto_Package never reads `sig.by` beyond copying it into the `Sig` it returns; the roster lookup and the WS `memberId` check belong to the Verifier in S-node-core and S-relay-core. Affects Requirements 7 and 8.
12. **Randomness helpers.** Only `randomBytes(n)` and the 16-byte Pairing_Secret generator; no ULID generator and no relay challenge nonce. Affects Requirements 4 and 11.
13. **Private JWK type.** `Private_JWK` is a TypeScript type local to the Crypto_Package with a hand-written structural check and no zod; public JWK validation uses the `JWK` schema of the Protocol_Package. Affects Requirements 1 and 5.
14. **Other runtime libraries.** None; `@noble/curves` and `@noble/hashes` are not used in this package; a watch without `crypto.subtle` matches the Known_Answer_Vectors in its own package. Affects Requirements 1 and 13.
15. **Missing WebCrypto and absent `body`.** `verify` returns `false` (fail closed); key generation and signing throw; a scope without `body` is neither signable nor verifiable. Affects Requirements 3, 7 and 8.
16. **ErrorCode for failed key or Base64url import.** `E_SCHEMA_INVALID`; `E_BAD_SIGNATURE` stays with the Verifier's response to `false`. Affects Requirements 3, 4 and 5.

Review answers (owner, 2026-11-12): all 16 defaults accepted; architecture v4.1.6 (C78) is now the normative source for 2, 4, 7, 9 and the dependency; Fix 1 (JWK-first ordering) and Fix 2 (empty secret throws on computation) applied.

## Appendix A: Traceability

| Requirement | Implements |
|---|---|
| 1 Package, dependency, dependency list | §20 row 2 (depends on 1), §6 preamble, §20 intro rules |
| 2 Runtime independence, boundary check | §20 row 2 R1 (runtime part), §16 Crypto row, P0-D1, SI-12 |
| 3 Failure model | §20 row 2 R3, §6.9 (`E_BAD_SIGNATURE`, `E_SCHEMA_INVALID`), SI-3, SI-12 |
| 4 Encoding, hashing, randomness | §20 row 2 (SHA-256), §6.1 (`sig.value` encoding, `requestHash`), §6.7 (`bodySha256`), §3.4 (128-bit secret) |
| 5 Keys, JWK, extractability | §20 row 2 (key import/export JWK), §6.2 (`RosterEntry.signPub`), §6.3 (`node.key`), §3.4 (fingerprint, compressed point), §4.5, SI-12 |
| 6 JCS | §20 row 2 R1, §6.1 (RFC 8785), §21.1 PBT #14, P0-D2 |
| 7 Signature scope and ES256 sign | §20 row 2 R2, §6.1 (signature encoding), §6.2 (`Sig`), SI-4 |
| 8 Verification | §20 row 2 R3, §6.1, SI-3, SI-4, SI-5 (limits), §21.1 PBT #6 |
| 9 requestHash | §20 row 2 R4, §6.1, SI-4, §21.1 PBT #6 |
| 10 WS-auth and WraithSig payloads | §6.3, §6.7 (field encodings), §20 row 2 R1 |
| 11 HMAC and pairing HMAC | §20 row 2 (HMAC), §3.4 (framing, fingerprint), §6.2 (`pair.complete`), §6.9 (`E_PAIR_HMAC_MISMATCH`) |
| 12 P0-D2 gate | P0-D2, §21.1 PBT #14, P0-D1 |
| 13 P0-D3 gate and PBTs | P0-D3, §21.1 PBT #6 and #14, SI-4, P0-D1 |
| 14 Traceability and boundaries | §20, §22.1, SI-3, SI-4, SI-5 |

| DoD or test id | Covered by |
|---|---|
| P0-D1 (crypto suites exist and run, non-empty) | Requirements 2, 12, 13 |
| P0-D2 (JCS byte-equality on Node and vitest-pool-workers) | Requirements 6, 12 |
| P0-D3 (sign then verify, mutate-any-byte, 1,000 runs) | Requirements 7, 8, 13 |
| §21.1 PBT #6 (crypto part) | Requirements 8, 9, 13 |
| §21.1 PBT #14 (JCS part) | Requirements 6, 12, 13 (browser run: Requirement 13 criterion 16) |
