import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkSiSource,
  HOOK_AUTO_APPROVE,
  HOOK_GROUPS,
  HOOK_TRUST_ALL,
  isProductCode,
  type SiHook,
  TOKEN_ALLOWED_FILES,
} from "../lib/si-rules.ts";
import { UNSAFE_GROUPS, UNSAFE_TOKENS } from "../lib/unsafe-tokens.ts";
import { pbt } from "./config.ts";

// Property 9: The SI scanners flag unsafe samples only in product code outside the allowed locations.
// Validates: Requirements 12.3, 12.4, 12.5, 12.6

const HOOKS: readonly SiHook[] = [HOOK_TRUST_ALL, HOOK_AUTO_APPROVE];

const PRODUCT_PATHS = [
  "apps/node/src/index.ts",
  "apps/sprite/src/launch.ts",
  "apps/relay-cf/src/worker.mts",
  "packages/relay-core/src/core.ts",
  "tools/check-si.ts",
  "package.json",
  ".githooks/pre-commit",
  "deploy/systemd/wraith.toml",
];
const NON_PRODUCT_PATHS = [
  "apps/node/src/index.test.ts",
  "apps/node/test/a.ts",
  "packages/fakes/src/fake.ts",
  "spike/hc/run.ts",
  "fixtures/a.json",
  "docs/notes.yml",
  ".kiro/hooks/x.json",
  "README.md",
  "docs/architecture.md",
  "apps/node/dist/index.js",
  "node_modules/x/index.js",
  "apps/node/src/image.png",
];
const ALLOWED_PATHS = [...TOKEN_ALLOWED_FILES];
const ALL_PATHS = [...PRODUCT_PATHS, ...NON_PRODUCT_PATHS, ...ALLOWED_PATHS];

const WORDS = ["alpha", "beta", "note", "build", "value", "text", "table", "lorem"] as const;
const benignLineArb = fc
  .array(fc.constantFrom(...WORDS), { minLength: 0, maxLength: 5 })
  .map((w) => w.join(" "));
const benignLinesArb = fc.array(benignLineArb, { minLength: 0, maxLength: 6 });

// Assembled so this file spells neither the marker nor the approval statement.
const MARKER = ["by: ", '"', "auto", "pilot", '"'].join("");
const APPROVAL = ["approval", ".", "respond"].join("");
const ALLOW = ["allow", "_", "once"].join("");

function place(before: string[], line: string, after: string[]): { text: string; at: number } {
  return { text: [...before, line, ...after].join("\n"), at: before.length + 1 };
}

describe("SI scanners (Property 9)", () => {
  it("Feature: s-ops-packaging, Property 9: unsafe samples are flagged iff product code, covered, not allowed", () => {
    const sampleArb = fc
      .constantFrom(...UNSAFE_GROUPS)
      .chain((group) =>
        fc
          .constantFrom(...UNSAFE_TOKENS[group].flatMap((e) => [...e.samples]))
          .map((sample) => ({ group, sample })),
      );
    pbt(
      fc.property(
        fc.constantFrom(...HOOKS),
        sampleArb,
        benignLinesArb,
        benignLinesArb,
        fc.constantFrom(...ALL_PATHS),
        (hook, { group, sample }, before, after, path) => {
          const { text, at } = place(before, sample, after);
          const found = checkSiSource(hook, path, text);
          const expected =
            isProductCode(path) &&
            HOOK_GROUPS[hook].includes(group) &&
            !TOKEN_ALLOWED_FILES.includes(path);
          const hit = found.some((f) => f.line === at && f.rule === `si/${hook}/${group}`);
          expect(hit).toBe(expected);
          // Findings never carry the matched text and are never raised off the placed line.
          for (const f of found) {
            expect(f.line).toBe(at);
            expect(Object.keys(f).sort()).toEqual(["file", "line", "rule"]);
          }
          if (!isProductCode(path)) expect(found).toEqual([]);
        },
      ),
    );
  });

  it("benign text yields no findings in any path", () => {
    pbt(
      fc.property(
        fc.constantFrom(...HOOKS),
        benignLinesArb,
        fc.constantFrom(...ALL_PATHS),
        (hook, lines, path) => {
          expect(checkSiSource(hook, path, lines.join("\n"))).toEqual([]);
        },
      ),
    );
  });

  it("autopilot marker and approval-with-allow are flagged only by the auto-approve hook, in product code, outside allowed prefixes", () => {
    const markerPaths = [
      "apps/node/src/index.ts",
      "apps/web/src/a.ts",
      "apps/node/src/autopilot/x.ts",
      "packages/protocol/src/m.ts",
      "docs/a.yml",
    ];
    const kindArb = fc.constantFrom("marker", "approval");
    pbt(
      fc.property(
        fc.constantFrom(...HOOKS),
        kindArb,
        benignLinesArb,
        benignLinesArb,
        fc.constantFrom(...markerPaths),
        (hook, kind, before, after, path) => {
          const stmt = kind === "marker" ? `x = { ${MARKER} }` : `send(${APPROVAL}, ${ALLOW})`;
          const { text, at } = place(before, stmt, after);
          const rule = `si/${hook}/${kind === "marker" ? "autopilot-marker" : "allow-unverified"}`;
          const allowedPrefixes =
            kind === "marker"
              ? ["packages/protocol/", "apps/node/src/autopilot/"]
              : [
                  "packages/protocol/",
                  "apps/web/",
                  "apps/watch-zepp/",
                  "apps/desktop/",
                  "apps/node/src/autopilot/",
                ];
          const expected =
            hook === HOOK_AUTO_APPROVE &&
            isProductCode(path) &&
            !allowedPrefixes.some((p) => path.startsWith(p));
          const hit = checkSiSource(hook, path, text).some((f) => f.line === at && f.rule === rule);
          expect(hit).toBe(expected);
        },
      ),
    );
  });

  it("every group of the unsafe-token module is covered by at least one hook", () => {
    for (const group of UNSAFE_GROUPS) {
      expect(HOOKS.some((h) => HOOK_GROUPS[h].includes(group))).toBe(true);
    }
  });
});
