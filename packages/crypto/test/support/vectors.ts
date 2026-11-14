import vectors from "../../../../fixtures/crypto/known-answers.json" with { type: "json" };

// Support module (not a test file). No node: imports, so it also runs in the workers project.

export interface Base64urlValidVector {
  id: string;
  bytesHex: string;
  text: string;
  source: string;
}

export interface Base64urlInvalidVector {
  id: string;
  text: string;
  reason: string;
  source: string;
}

export interface Base64urlVectors {
  valid: Base64urlValidVector[];
  invalid: Base64urlInvalidVector[];
}

export interface Sha256Vector {
  id: string;
  inputHex: string;
  digestHex: string;
  source: string;
}

interface JcsVectorBase {
  id: string;
  /** UTF-8 bytes of the expected canonical output, lower-case hex text. */
  expectedHex: string;
  source: string;
}
/** `bits` is the 64-bit IEEE-754 pattern as 16 lower-case hex digits; the test builds the number. */
export interface JcsNumberVector extends JcsVectorBase {
  kind: "number";
  bits: string;
}
/** `inputJson` is JSON text; the test must parse it with JSON.parse (own `__proto__` members). */
export interface JcsJsonVector extends JcsVectorBase {
  kind: "json";
  inputJson: string;
}
/** The test builds an array nested `depth` levels; expected is "[" x depth then "]" x depth. */
export interface JcsDepthVector extends JcsVectorBase {
  kind: "depth";
  depth: number;
}
export type JcsVector = JcsNumberVector | JcsJsonVector | JcsDepthVector;
/** Public JWK members only; the vectors file never holds a private value. */
export interface KeyJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
}
export interface KeyValidVector {
  id: string;
  jwk: KeyJwk;
  /** 33-byte compressed SEC1 point, lower-case hex. */
  compressedHex: string;
  /** SHA-256 of the 33 compressed bytes, lower-case hex. */
  fingerprintHex: string;
  source: string;
}
export interface KeyInvalidCompressedVector {
  id: string;
  compressedHex: string;
  reason: string;
  source: string;
}
export interface KeyInvalidJwkVector {
  id: string;
  /** Arbitrary JSON object (may carry members such as kid or a wrong kty). */
  jwk: Record<string, unknown>;
  /** When true the test adds a private member `d` itself; the file stores none. */
  withD: boolean;
  reason: string;
  source: string;
}
/** Valid public key spelled with ignored members (use, key_ops, ext, alg). */
export interface KeyIgnoredMembersVector extends KeyValidVector {
  jwk: KeyJwk & Record<string, unknown>;
}
export interface KeyVectors {
  valid: KeyValidVector[];
  invalidCompressed: KeyInvalidCompressedVector[];
  invalidJwk: KeyInvalidJwkVector[];
  validIgnoredMembers: KeyIgnoredMembersVector[];
}
export interface KnownAnswers {
  version: number;
  base64url: Base64urlVectors;
  sha256: Sha256Vector[];
  jcs: JcsVector[];
  keys: KeyVectors;
}

const HEX = /^(?:[0-9a-f]{2})*$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: Record<string, unknown>, key: string): string {
  const value = v[key];
  if (typeof value !== "string") {
    throw new Error(`known-answers.json: "${key}" must be a string`);
  }
  return value;
}

function hex(v: Record<string, unknown>, key: string): string {
  const value = str(v, key);
  if (!HEX.test(value)) {
    throw new Error(`known-answers.json: "${key}" must be lower-case hex text`);
  }
  return value;
}

function list(v: unknown, name: string): Record<string, unknown>[] {
  if (!Array.isArray(v) || !v.every(isRecord)) {
    throw new Error(`known-answers.json: "${name}" must be an array of objects`);
  }
  return v;
}

function parseJcsVector(e: Record<string, unknown>): JcsVector {
  const base = { id: str(e, "id"), expectedHex: hex(e, "expectedHex"), source: str(e, "source") };
  switch (e.kind) {
    case "number": {
      const bits = hex(e, "bits");
      if (bits.length !== 16) {
        throw new Error('known-answers.json: "bits" must be 16 hex digits');
      }
      return { ...base, kind: "number", bits };
    }
    case "json":
      return { ...base, kind: "json", inputJson: str(e, "inputJson") };
    case "depth": {
      const depth = e.depth;
      if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 0) {
        throw new Error('known-answers.json: "depth" must be a non-negative integer');
      }
      return { ...base, kind: "depth", depth };
    }
    default:
      throw new Error('known-answers.json: jcs "kind" must be "number", "json" or "depth"');
  }
}
function parseKeyJwk(v: unknown): KeyJwk & Record<string, unknown> {
  if (!isRecord(v)) {
    throw new Error('known-answers.json: "jwk" must be an object');
  }
  if ("d" in v) {
    throw new Error('known-answers.json: "jwk" must not contain a private member');
  }
  return { ...v, kty: str(v, "kty"), crv: str(v, "crv"), x: str(v, "x"), y: str(v, "y") };
}

function parseKeyValid(e: Record<string, unknown>): KeyIgnoredMembersVector {
  const compressedHex = hex(e, "compressedHex");
  const fingerprintHex = hex(e, "fingerprintHex");
  if (compressedHex.length !== 66 || fingerprintHex.length !== 64) {
    throw new Error(
      'known-answers.json: "compressedHex" must be 33 bytes and "fingerprintHex" 32 bytes',
    );
  }
  return {
    id: str(e, "id"),
    jwk: parseKeyJwk(e.jwk),
    compressedHex,
    fingerprintHex,
    source: str(e, "source"),
  };
}

function parseKeys(raw: unknown): KeyVectors {
  if (!isRecord(raw)) {
    throw new Error('known-answers.json: "keys" must be an object');
  }
  const valid = list(raw.valid, "keys.valid").map(parseKeyValid);
  const invalidCompressed = list(raw.invalidCompressed, "keys.invalidCompressed").map((e) => ({
    id: str(e, "id"),
    compressedHex: hex(e, "compressedHex"),
    reason: str(e, "reason"),
    source: str(e, "source"),
  }));
  const invalidJwk = list(raw.invalidJwk, "keys.invalidJwk").map((e) => {
    if (!isRecord(e.jwk)) {
      throw new Error('known-answers.json: "jwk" must be an object');
    }
    if ("d" in e.jwk) {
      throw new Error('known-answers.json: "jwk" must not contain a private member');
    }
    return {
      id: str(e, "id"),
      jwk: e.jwk,
      withD: e.withD === true,
      reason: str(e, "reason"),
      source: str(e, "source"),
    };
  });
  const validIgnoredMembers = list(raw.validIgnoredMembers, "keys.validIgnoredMembers").map(
    parseKeyValid,
  );
  return { valid, invalidCompressed, invalidJwk, validIgnoredMembers };
}

/** Hand-written shape guard (no zod). Throws with the offending field on a bad file. */
export function parseKnownAnswers(raw: unknown): KnownAnswers {
  if (!isRecord(raw) || typeof raw.version !== "number") {
    throw new Error("known-answers.json: root must be an object with a numeric version");
  }
  if (!isRecord(raw.base64url)) {
    throw new Error('known-answers.json: "base64url" must be an object');
  }
  const valid = list(raw.base64url.valid, "base64url.valid").map((e) => ({
    id: str(e, "id"),
    bytesHex: hex(e, "bytesHex"),
    text: str(e, "text"),
    source: str(e, "source"),
  }));
  const invalid = list(raw.base64url.invalid, "base64url.invalid").map((e) => ({
    id: str(e, "id"),
    text: str(e, "text"),
    reason: str(e, "reason"),
    source: str(e, "source"),
  }));
  const sha256 = list(raw.sha256, "sha256").map((e) => ({
    id: str(e, "id"),
    inputHex: hex(e, "inputHex"),
    digestHex: hex(e, "digestHex"),
    source: str(e, "source"),
  }));
  const jcs = list(raw.jcs, "jcs").map(parseJcsVector);
  const keys = parseKeys(raw.keys);
  return { version: raw.version, base64url: { valid, invalid }, sha256, jcs, keys };
}

const knownAnswers: KnownAnswers = parseKnownAnswers(vectors);

export function getBase64urlVectors(): Base64urlVectors {
  return knownAnswers.base64url;
}

export function getSha256Vectors(): Sha256Vector[] {
  return knownAnswers.sha256;
}
export function getJcsVectors(): JcsVector[] {
  return knownAnswers.jcs;
}

export function getKeyVectors(): KeyVectors {
  return knownAnswers.keys;
}
