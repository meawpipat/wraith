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

export interface KnownAnswers {
  version: number;
  base64url: Base64urlVectors;
  sha256: Sha256Vector[];
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
  return { version: raw.version, base64url: { valid, invalid }, sha256 };
}

const knownAnswers: KnownAnswers = parseKnownAnswers(vectors);

export function getBase64urlVectors(): Base64urlVectors {
  return knownAnswers.base64url;
}

export function getSha256Vectors(): Sha256Vector[] {
  return knownAnswers.sha256;
}
