import type { SecretClass } from "../../lib/secret-rules.ts";

/**
 * Sample builders for the Secret_Scan tests. Every sample is joined from fragments at call
 * time, so no complete secret-shaped string exists in this source text.
 */

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
export const ALPHA_BASE62 = UPPER + LOWER + DIGITS;
export const ALPHA_UPPER_DIGITS = UPPER + DIGITS;
export const ALPHA_BASE64URL = `${ALPHA_BASE62}-_`;
export const ALPHA_BASE64 = `${ALPHA_BASE62}+/`;

/** Deterministic body with at least three distinct characters (alphabet >= 3, length >= 3). */
export function makeBody(alphabet: string, length: number, seed = 0): string {
  let out = "";
  for (let i = 0; i < length; i++)
    out += alphabet.charAt((i * 7 + seed * 13 + i * i) % alphabet.length);
  return out;
}

export interface SecretSample {
  readonly cls: SecretClass;
  /** File name the scan must be given (`node.key` selects its class). */
  readonly fileName: string;
  /** Characters a generated body may use. */
  readonly alphabet: string;
  /** Exact body length expected by `build`. */
  readonly bodyLength: number;
  readonly build: (body: string) => string;
}

function jsonLine(entries: readonly (readonly [string, string])[]): string {
  return JSON.stringify(Object.fromEntries(entries));
}

function jwkSample(body: string): string {
  const filler = makeBody(ALPHA_BASE64URL, 43, 5);
  return jsonLine([
    ["kty", "EC"],
    ["crv", ["P", "-256"].join("")],
    ["x", filler],
    ["y", filler],
    ["d", body],
  ]);
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export const SECRET_SAMPLES: readonly SecretSample[] = [
  {
    cls: "github-token",
    fileName: "sample.txt",
    alphabet: ALPHA_BASE62,
    bodyLength: 36,
    build: (body) => ["g", "h", "p", "_"].join("") + body,
  },
  {
    cls: "aws-access-key",
    fileName: "sample.txt",
    alphabet: ALPHA_UPPER_DIGITS,
    bodyLength: 16,
    build: (body) => ["AK", "IA"].join("") + body,
  },
  {
    cls: "slack-token",
    fileName: "sample.txt",
    alphabet: ALPHA_BASE62,
    bodyLength: 24,
    build: (body) =>
      ["xo", "xb-"].join("") + [body.slice(0, 8), body.slice(8, 16), body.slice(16)].join("-"),
  },
  {
    cls: "jwt",
    fileName: "sample.txt",
    alphabet: ALPHA_BASE64URL,
    bodyLength: 43,
    build: (body) =>
      [b64url({ alg: "HS256", typ: "JWT" }), b64url({ sub: "u1", iat: 1 }), body].join("."),
  },
  {
    cls: "pem-private-key",
    fileName: "sample.txt",
    alphabet: ALPHA_BASE64,
    bodyLength: 64,
    build: (body) =>
      [
        ["-----", "BEGIN ", "PRIVATE", " KEY-----"].join(""),
        body,
        ["-----", "END ", "PRIVATE", " KEY-----"].join(""),
      ].join("\n"),
  },
  {
    cls: "jwk-private",
    fileName: "sample.json",
    alphabet: ALPHA_BASE64URL,
    bodyLength: 43,
    build: jwkSample,
  },
  {
    cls: "vapid-private-key",
    fileName: "sample.env",
    alphabet: ALPHA_BASE64URL,
    bodyLength: 43,
    build: (body) => [["VAPID", "_PRIVATE", "_KEY"].join(""), body].join("="),
  },
  {
    cls: "setup-token",
    fileName: "sample.env",
    alphabet: ALPHA_BASE62,
    bodyLength: 22,
    // The fixed digit prefix guarantees the digit the rule requires.
    build: (body) => [["SETUP", "_TOKEN"].join(""), `k9${body}`].join("="),
  },
  {
    cls: "node-key",
    fileName: "node.key",
    alphabet: ALPHA_BASE64URL,
    bodyLength: 43,
    build: jwkSample,
  },
];

export function sampleFor(cls: SecretClass): SecretSample {
  const found = SECRET_SAMPLES.find((s) => s.cls === cls);
  if (!found) throw new Error(`no sample builder for ${cls}`);
  return found;
}

/** A complete sample of the class with a deterministic default body. */
export function buildSample(cls: SecretClass, seed = 0): { fileName: string; text: string } {
  const s = sampleFor(cls);
  return { fileName: s.fileName, text: s.build(makeBody(s.alphabet, s.bodyLength, seed)) };
}

export type DecoyKind =
  | "public-jwk"
  | "placeholder-run"
  | "one-under-minimum"
  | "rfc4231-hex"
  | "pem-public-key"
  | "pem-header-no-body"
  | "jwt-first-part-not-json";

export interface Decoy {
  readonly kind: DecoyKind;
  readonly fileName: string;
  readonly build: () => string;
}

export const DECOYS: readonly Decoy[] = [
  {
    kind: "public-jwk",
    fileName: "sample.json",
    build: () =>
      jsonLine([
        ["kty", "EC"],
        ["crv", ["P", "-256"].join("")],
        ["x", makeBody(ALPHA_BASE64URL, 43, 2)],
        ["y", makeBody(ALPHA_BASE64URL, 43, 3)],
      ]),
  },
  {
    kind: "placeholder-run",
    fileName: "sample.txt",
    build: () => ["gh", "p_"].join("") + "x".repeat(8),
  },
  {
    kind: "one-under-minimum",
    fileName: "sample.txt",
    build: () => ["gh", "p_"].join("") + makeBody(ALPHA_BASE62, 35, 1),
  },
  {
    // 32-byte hex digest in the shape of the RFC 4231 HMAC test vectors.
    kind: "rfc4231-hex",
    fileName: "vectors.json",
    build: () =>
      ["b0344c61d8db3853", "5ca8afceaf0bf12b", "881dc200c9833da7", "26e9376c2e32cff7"].join(""),
  },
  {
    kind: "pem-public-key",
    fileName: "sample.txt",
    build: () =>
      [
        ["-----", "BEGIN ", "PUBLIC", " KEY-----"].join(""),
        makeBody(ALPHA_BASE64, 64, 4),
        ["-----", "END ", "PUBLIC", " KEY-----"].join(""),
      ].join("\n"),
  },
  {
    kind: "pem-header-no-body",
    fileName: "sample.txt",
    build: () => `${["-----", "BEGIN ", "PRIVATE", " KEY-----"].join("")}\nthe header alone`,
  },
  {
    kind: "jwt-first-part-not-json",
    fileName: "sample.txt",
    build: () =>
      [["ey", "Jub3Rqc29u"].join(""), b64url({ sub: "u1" }), makeBody(ALPHA_BASE64URL, 43, 6)].join(
        ".",
      ),
  },
];
