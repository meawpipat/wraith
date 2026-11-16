import type { Finding } from "./finding.ts";

export type SecretClass =
  | "github-token"
  | "aws-access-key"
  | "slack-token"
  | "jwt"
  | "pem-private-key"
  | "jwk-private"
  | "vapid-private-key"
  | "setup-token"
  | "node-key";

export interface SecretRule {
  readonly cls: SecretClass;
  /** Offsets of matches only. The matched text never leaves this module. */
  readonly find: (text: string, file: string) => readonly number[];
}

/** A body with at most two distinct characters is a placeholder (decision D6). */
function isPlaceholder(body: string): boolean {
  return new Set(body).size <= 2;
}

function isNodeKeyFile(file: string): boolean {
  const parts = file.split(/[\\/]/);
  return parts[parts.length - 1] === "node.key";
}

const GITHUB_RE = /gh[pousr]_([A-Za-z0-9]{36})/g;
const GITHUB_PAT_RE = /github_pat_([A-Za-z0-9_]{22,})/g;

function findGithub(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(GITHUB_RE)) {
    if (!isPlaceholder(m[1] ?? "")) out.push(m.index);
  }
  for (const m of text.matchAll(GITHUB_PAT_RE)) {
    if (!isPlaceholder(m[1] ?? "")) out.push(m.index);
  }
  return out;
}

const AWS_RE = /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)([A-Z0-9]{16})\b/g;

function findAws(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(AWS_RE)) {
    if (!isPlaceholder(m[1] ?? "")) out.push(m.index);
  }
  return out;
}

const SLACK_RE = /(?<![A-Za-z0-9])xox[abprs]-([A-Za-z0-9]+(?:-[A-Za-z0-9]+){2,})/g;
const SLACK_APP_RE = /(?<![A-Za-z0-9])xapp-([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)/g;
const SLACK_MIN_LENGTH = 24;

function findSlack(text: string): number[] {
  const out: number[] = [];
  for (const re of [SLACK_RE, SLACK_APP_RE]) {
    for (const m of text.matchAll(re)) {
      if (m[0].length < SLACK_MIN_LENGTH) continue;
      if (!isPlaceholder((m[1] ?? "").replaceAll("-", ""))) out.push(m.index);
    }
  }
  return out;
}

const JWT_RE = /(?<![A-Za-z0-9_-])(eyJ[A-Za-z0-9_-]*)\.(eyJ[A-Za-z0-9_-]*)\.([A-Za-z0-9_-]{8,})/g;
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });

/** Strict base64url (canonical, no padding), UTF-8, JSON object. */
function decodesToJsonObject(part: string): boolean {
  if (part.length % 4 === 1) return false;
  try {
    const bytes = Buffer.from(part, "base64url");
    if (bytes.toString("base64url") !== part) return false;
    const value: unknown = JSON.parse(UTF8_FATAL.decode(bytes));
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

function findJwt(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(JWT_RE)) {
    const [, head = "", payload = "", sig = ""] = m;
    if (isPlaceholder(sig)) continue;
    if (decodesToJsonObject(head) && decodesToJsonObject(payload)) out.push(m.index);
  }
  return out;
}

const PEM_HEADER_RE = /-{5}BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-+/g;
const PEM_BODY_LINE_RE = /^[A-Za-z0-9+/=]{32,}$/;
const PEM_LOOKAHEAD = 16384;

/** True when a body line follows the header before the END line (decision D6). */
function hasPemBodyLine(rest: string): boolean {
  const end = rest.indexOf("-----END");
  const block = end === -1 ? rest : rest.slice(0, end);
  let sawField = false;
  // The first segment is the tail of the header line itself.
  for (const raw of block.split(/\r?\n|\\r?\\n/).slice(1)) {
    const line = raw.trim();
    if (line === "") {
      if (sawField) continue;
      break;
    }
    if (PEM_BODY_LINE_RE.test(line)) {
      if (!isPlaceholder(line)) return true;
      continue;
    }
    if (line.includes(":")) sawField = true;
  }
  return false;
}

function findPem(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(PEM_HEADER_RE)) {
    const from = m.index + m[0].length;
    if (hasPemBodyLine(text.slice(from, from + PEM_LOOKAHEAD))) out.push(m.index);
  }
  return out;
}

const JWK_D_RE = /\\*"d\\*"\s*:\s*\\*"([A-Za-z0-9_-]{43,132})\\*"/g;
const JWK_KTY_RE = /\\*"kty\\*"/;
const JWK_CRV_OR_X_RE = /\\*"(?:crv|x)\\*"/;
const JWK_WINDOW = 600;

function findJwkPrivate(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(JWK_D_RE)) {
    if (isPlaceholder(m[1] ?? "")) continue;
    const window = text.slice(
      Math.max(0, m.index - JWK_WINDOW),
      m.index + m[0].length + JWK_WINDOW,
    );
    if (JWK_KTY_RE.test(window) && JWK_CRV_OR_X_RE.test(window)) out.push(m.index);
  }
  return out;
}

const VAPID_RE =
  /(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_-]*)["']?\s*[=:]\s*["']?([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g;

function findVapid(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(VAPID_RE)) {
    const id = (m[1] ?? "").toLowerCase();
    if (!id.includes("vapid") || !id.includes("private")) continue;
    if (!isPlaceholder(m[2] ?? "")) out.push(m.index);
  }
  return out;
}

const SETUP_TOKEN_RE = /SETUP_TOKEN["']?\s*[=:]\s*["']?([A-Za-z0-9_+/=-]{12,})/g;

function findSetupToken(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(SETUP_TOKEN_RE)) {
    const value = m[1] ?? "";
    const next = text.charAt(m.index + m[0].length);
    if (next === "(" || next === ".") continue;
    if (!/\d/.test(value) || isPlaceholder(value)) continue;
    out.push(m.index);
  }
  return out;
}

export const SECRET_RULES: readonly SecretRule[] = [
  { cls: "github-token", find: findGithub },
  { cls: "aws-access-key", find: findAws },
  { cls: "slack-token", find: findSlack },
  { cls: "jwt", find: findJwt },
  { cls: "pem-private-key", find: findPem },
  // Same detector as node-key: a node.key file is reported under node-key only.
  { cls: "jwk-private", find: (text, file) => (isNodeKeyFile(file) ? [] : findJwkPrivate(text)) },
  { cls: "vapid-private-key", find: findVapid },
  { cls: "setup-token", find: findSetupToken },
  {
    cls: "node-key",
    find: (text, file) => {
      if (!isNodeKeyFile(file)) return [];
      const first = text.search(/\S/);
      return first === -1 ? [] : [first];
    },
  },
];

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineOf(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** One finding per match, rule `secret/<class>`, ordered by line then rule order. */
export function scanText(file: string, text: string): Finding[] {
  const starts = lineStarts(text);
  const found: { line: number; order: number; rule: string }[] = [];
  SECRET_RULES.forEach((rule, order) => {
    const seen = new Set<number>();
    for (const offset of rule.find(text, file)) {
      if (seen.has(offset)) continue;
      seen.add(offset);
      found.push({ line: lineOf(starts, offset), order, rule: `secret/${rule.cls}` });
    }
  });
  found.sort((a, b) => a.line - b.line || a.order - b.order);
  return found.map((f) => ({ file, line: f.line, rule: f.rule }));
}
