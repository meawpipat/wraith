import { describe, expect, it } from "vitest";
import { SECRET_RULES } from "../../tools/lib/secret-rules.ts";
import { UNSAFE_TOKENS } from "../../tools/lib/unsafe-tokens.ts";
import { redactText } from "../lib/redact.ts";
import { ALPHA_BASE62, buildSample, DECOYS, makeBody } from "./support/samples.ts";

const HOME = "/Users/someone";
const REAL_HOME = "/private/Users/someone";

function opts(file = "sample.txt", env: Record<string, string> = {}) {
  return { file, home: HOME, realHome: REAL_HOME, env };
}

describe("redactText", () => {
  for (const rule of SECRET_RULES) {
    it(`replaces the whole line of a ${rule.cls} sample`, () => {
      const { fileName, text } = buildSample(rule.cls);
      const lead = rule.cls === "node-key" ? "" : "before\n";
      const input = `${lead}${text}\nafter\n`;
      const r = redactText(input, opts(fileName));
      const lines = r.text.split("\n");
      expect(r.lineCount).toBe(input.split("\n").length);
      expect(lines.length).toBe(input.split("\n").length);
      expect(lines.some((l) => l === `[REDACTED-LINE:${rule.cls}]`)).toBe(true);
      expect(r.text).not.toContain(text.split("\n")[0] ?? "");
      expect(r.text.endsWith("after\n")).toBe(true);
      expect(r.replaced[rule.cls]).toBeGreaterThan(0);
    });
  }

  it("replaces every line of a multi-line PEM block and keeps the rest", () => {
    const { text } = buildSample("pem-private-key");
    const r = redactText(`a\n${text}\nb`, opts());
    expect(r.text).toBe(
      [
        "a",
        "[REDACTED-LINE:pem-private-key]",
        "[REDACTED-LINE:pem-private-key]",
        "[REDACTED-LINE:pem-private-key]",
        "b",
      ].join("\n"),
    );
    expect(r.replaced["pem-private-key"]).toBe(3);
  });

  it("replaces only the secret line of a JSONL file", () => {
    const { text } = buildSample("github-token");
    const keep1 = JSON.stringify({ n: 1 });
    const keep2 = JSON.stringify({ n: 3 });
    const secret = JSON.stringify({ n: 2, v: text });
    const r = redactText(`${keep1}\n${secret}\n${keep2}\n`, opts());
    expect(r.text).toBe(`${keep1}\n[REDACTED-LINE:github-token]\n${keep2}\n`);
  });

  it("replaces a line that holds an SI token taken from the imported set", () => {
    const sample = UNSAFE_TOKENS.argvFlags[0].samples[0];
    const r = redactText(`ok\nusage: tool ${sample} more\nend`, opts());
    expect(r.text).toBe("ok\n[REDACTED-LINE:si-token]\nend");
    expect(r.replaced["si-token"]).toBe(1);
  });

  it("leaves decoys unchanged", () => {
    for (const d of DECOYS) {
      const input = d.build();
      expect(redactText(input, opts(d.fileName)).text).toBe(input);
    }
  });

  it("masks home and real home prefixes", () => {
    const r = redactText(`${REAL_HOME}/x and ${HOME}/y`, opts());
    expect(r.text).toBe("~/x and ~/y");
    expect(r.homeMasked).toBe(2);
  });

  it("masks long secret-named env values and leaves short or other ones", () => {
    const long = makeBody(ALPHA_BASE62, 12, 3).toLowerCase();
    const env = { MY_API_TOKEN: long, DB_PASSWORD: "short", PLAIN: "plainvalue123" };
    const r = redactText(`v=${long} s=short p=plainvalue123`, opts("sample.txt", env));
    expect(r.text).toBe("v=<ENV:MY_API_TOKEN> s=short p=plainvalue123");
    expect(r.envMasked).toBe(1);
  });
});
