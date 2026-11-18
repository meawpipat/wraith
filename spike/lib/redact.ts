import { type SecretClass, scanText } from "../../tools/lib/secret-rules.ts";
import { findUnsafeToken } from "../../tools/lib/unsafe-tokens.ts";

export interface RedactOptions {
  file: string;
  home: string;
  realHome: string;
  env: Readonly<Record<string, string | undefined>>;
}

export interface RedactResult {
  text: string;
  /** Equals the input line count (split on `\n` only). */
  lineCount: number;
  replaced: Partial<Record<SecretClass | "si-token", number>>;
  homeMasked: number;
  envMasked: number;
}

const PEM_MAX_FOLLOWING_LINES = 200;
const ENV_NAME_RE = /TOKEN|KEY|SECRET|PASSWORD/i;
const ENV_MIN_LENGTH = 8;

function marker(cls: string): string {
  return `[REDACTED-LINE:${cls}]`;
}

/** Replaces every occurrence of `needle` and returns the new text and the count. */
function replaceAllCounted(text: string, needle: string, to: string): [string, number] {
  if (needle === "") return [text, 0];
  const parts = text.split(needle);
  return [parts.join(to), parts.length - 1];
}

/**
 * Whole-line redaction (OQ-13): a line that holds a secret-shaped match or an SI token
 * becomes a marker, so the line count never changes and no secret is held in a log.
 */
export function redactText(input: string, o: RedactOptions): RedactResult {
  const lines = input.split("\n");
  const marked: (string | null)[] = lines.map(() => null);
  const replaced: Partial<Record<SecretClass | "si-token", number>> = {};
  const mark = (index: number, cls: SecretClass | "si-token"): void => {
    if (marked[index] !== null) return;
    marked[index] = marker(cls);
    replaced[cls] = (replaced[cls] ?? 0) + 1;
  };

  // Pass 1: secret rules.
  for (const f of scanText(o.file, input)) {
    const cls = f.rule.slice("secret/".length) as SecretClass;
    const index = f.line - 1;
    mark(index, cls);
    if (cls === "pem-private-key") {
      const last = Math.min(lines.length - 1, index + PEM_MAX_FOLLOWING_LINES);
      for (let i = index + 1; i <= last; i++) {
        mark(i, cls);
        if ((lines[i] ?? "").includes("-----END")) break;
      }
    }
  }

  // Pass 2: SI tokens (D9).
  lines.forEach((line, i) => {
    if (marked[i] === null && findUnsafeToken(line) !== null) mark(i, "si-token");
  });

  const out = lines.map((line, i) => marked[i] ?? line);
  let text = out.join("\n");

  // Pass 3: home prefixes, longest first.
  let homeMasked = 0;
  const homes = [...new Set([o.home, o.realHome])]
    .filter((h) => h.length > 1 && h !== "/")
    .sort((a, b) => b.length - a.length);
  for (const h of homes) {
    const [next, n] = replaceAllCounted(text, h, "~");
    text = next;
    homeMasked += n;
  }

  // Pass 4: environment values (D6a), longest first.
  let envMasked = 0;
  const secrets = Object.entries(o.env)
    .filter(
      (e): e is [string, string] =>
        ENV_NAME_RE.test(e[0]) && typeof e[1] === "string" && e[1].length >= ENV_MIN_LENGTH,
    )
    .sort((a, b) => b[1].length - a[1].length);
  for (const [name, value] of secrets) {
    const [next, n] = replaceAllCounted(text, value, `<ENV:${name}>`);
    text = next;
    envMasked += n;
  }

  return { text, lineCount: lines.length, replaced, homeMasked, envMasked };
}
