import * as fc from "fast-check";
import { describe, it } from "vitest";
import { type SecretClass, scanText } from "../../tools/lib/secret-rules.ts";
import { findUnsafeToken, UNSAFE_TOKENS } from "../../tools/lib/unsafe-tokens.ts";
import { redactText } from "../lib/redact.ts";
import { pbt } from "./config.ts";
import { SECRET_SAMPLES } from "./support/samples.ts";

const HOME = "/Users/someone";
const REAL_HOME = "/private/Users/someone";
const FILE = "sample.txt";

const ordinaryLine = fc.stringMatching(/^[a-z ]{0,30}$/);

// node-key is only reported for a file named node.key, so it has its own property below.
const MIXED_SAMPLES = SECRET_SAMPLES.filter((s) => s.cls !== "node-key" && s.cls !== "jwk-private");
const JWK_SAMPLE = SECRET_SAMPLES.find((s) => s.cls === "jwk-private");
const NODE_KEY_SAMPLE = SECRET_SAMPLES.find((s) => s.cls === "node-key");

interface Piece {
  kind: "plain" | SecretClass;
  text: string;
  lines: number;
}

function secretPiece(sample: (typeof SECRET_SAMPLES)[number]): fc.Arbitrary<Piece> {
  return fc
    .stringMatching(new RegExp(`^[${sample.alphabet.replace(/[\\\]^-]/g, "\\$&")}]{1,9}$`))
    .chain((seed) =>
      fc.constant(
        (() => {
          // Distinct-character body of the exact length from a generated seed.
          let body = "";
          for (let i = 0; body.length < sample.bodyLength; i++) {
            body += sample.alphabet.charAt(
              (seed.charCodeAt(i % seed.length) * 31 + i * 7 + i * i) % sample.alphabet.length,
            );
          }
          const text = sample.build(body);
          return { kind: sample.cls, text, lines: text.split("\n").length };
        })(),
      ),
    );
}

const piece: fc.Arbitrary<Piece> = fc.oneof(
  ordinaryLine.map((text) => ({ kind: "plain" as const, text, lines: 1 })),
  ...[...MIXED_SAMPLES, ...(JWK_SAMPLE ? [JWK_SAMPLE] : [])].map(secretPiece),
);

describe("Feature: s-spikes, Property 11: The redactor preserves line count and covers every secret class", () => {
  it("keeps the line count, replaces every reported line and leaves the result clean", () => {
    pbt(
      fc.property(fc.array(piece, { minLength: 1, maxLength: 12 }), (pieces) => {
        const input = pieces.map((p) => p.text).join("\n");
        const o = { file: FILE, home: HOME, realHome: REAL_HOME, env: {} };
        const r = redactText(input, o);
        const outLines = r.text.split("\n");
        const inLines = input.split("\n");
        if (outLines.length !== inLines.length || r.lineCount !== inLines.length) return false;
        const reported = new Map<number, string>();
        for (const f of scanText(FILE, input)) {
          if (!reported.has(f.line)) reported.set(f.line, f.rule.slice("secret/".length));
        }
        const expected: Record<string, number> = {};
        let at = 0;
        for (const p of pieces) {
          for (let i = 0; i < p.lines; i++) {
            const lineNo = at + i + 1;
            const out = outLines[at + i];
            if (p.kind === "plain") {
              if (out !== inLines[at + i]) return false;
            } else {
              const cls = reported.get(lineNo) ?? p.kind;
              if (out !== `[REDACTED-LINE:${cls}]`) return false;
              expected[cls] = (expected[cls] ?? 0) + 1;
            }
          }
          at += p.lines;
        }
        if (scanText(FILE, r.text).length !== 0) return false;
        const got = r.replaced as Record<string, number>;
        const keys = new Set([...Object.keys(expected), ...Object.keys(got)]);
        for (const k of keys) if ((got[k] ?? 0) !== (expected[k] ?? 0)) return false;
        return true;
      }),
    );
  });

  it("redacts a node.key file's first non-blank line and keeps the rest", () => {
    if (!NODE_KEY_SAMPLE) throw new Error("no node-key sample");
    const sample = NODE_KEY_SAMPLE;
    pbt(
      fc.property(fc.array(ordinaryLine, { maxLength: 8 }), (rest) => {
        const secret = sample.build("A".repeat(0) + "aB3-_".repeat(9).slice(0, sample.bodyLength));
        const input = [secret, ...rest].join("\n");
        const r = redactText(input, { file: "node.key", home: HOME, realHome: REAL_HOME, env: {} });
        const out = r.text.split("\n");
        return (
          out.length === rest.length + 1 &&
          out[0] === "[REDACTED-LINE:node-key]" &&
          out.slice(1).join("\n") === rest.join("\n") &&
          r.replaced["node-key"] === 1
        );
      }),
    );
  });
});

const homeWord = fc.stringMatching(/^[a-z]{1,8}$/);
const envValue = fc.stringMatching(/^[a-z0-9]{8,20}$/);
const siSample = fc.constantFrom(
  ...UNSAFE_TOKENS.argvFlags.flatMap((t) => t.samples),
  ...UNSAFE_TOKENS.envNames.flatMap((t) => t.samples),
  ...UNSAFE_TOKENS.settingsValues.flatMap((t) => t.samples),
  ...UNSAFE_TOKENS.patterns.flatMap((t) => t.samples),
);

describe("Feature: s-spikes, Property 12: Redaction is idempotent and masks home paths and environment values", () => {
  it("is idempotent and leaves no home path, env value or SI token", () => {
    pbt(
      fc.property(
        homeWord,
        homeWord,
        fc.array(envValue, { minLength: 1, maxLength: 3 }),
        fc.array(
          fc.oneof(
            ordinaryLine.map((text) => ({ t: "plain" as const, text })),
            homeWord.map((w) => ({ t: "home" as const, text: w })),
            homeWord.map((w) => ({ t: "realHome" as const, text: w })),
            fc.nat(2).map((i) => ({ t: "env" as const, text: String(i) })),
            siSample.map((s) => ({ t: "si" as const, text: s })),
          ),
          { minLength: 1, maxLength: 10 },
        ),
        (a, b, values, parts) => {
          const home = `/Users/${a}`;
          const realHome = `/private/Users/${b}x`;
          const env: Record<string, string> = {};
          values.forEach((v, i) => {
            env[["MY", "API", "TOKEN", String(i)].join("_")] = v;
          });
          const lines = parts.map((p) => {
            if (p.t === "home") return `cd ${home}/${p.text}`;
            if (p.t === "realHome") return `cd ${realHome}/${p.text}`;
            if (p.t === "env") return `v=${values[Number(p.text) % values.length]}`;
            if (p.t === "si") return `run ${p.text} now`;
            return p.text;
          });
          const o = { file: FILE, home, realHome, env };
          const once = redactText(lines.join("\n"), o).text;
          const twice = redactText(once, o).text;
          if (once !== twice) return false;
          if (once.includes(home) || once.includes(realHome)) return false;
          if (values.some((v) => once.includes(v))) return false;
          return findUnsafeToken(once) === null;
        },
      ),
    );
  });
});
