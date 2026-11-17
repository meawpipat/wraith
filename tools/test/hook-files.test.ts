import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findUnsafeToken } from "../lib/unsafe-tokens.ts";

const here = dirname(fileURLToPath(import.meta.url));
const hooksDir = join(resolve(here, "..", ".."), ".kiro", "hooks");

describe("secret-scan hook file", () => {
  const file = join(hooksDir, "secret-scan.json");

  it("parses with version v1 and one PreToolUse command hook", () => {
    const json = JSON.parse(readFileSync(file, "utf8"));
    expect(json.version).toBe("v1");
    expect(json.hooks).toHaveLength(1);
    const hook = json.hooks[0];
    expect(hook.name).toBe("secret-scan");
    expect(hook.trigger).toBe("PreToolUse");
    expect(hook.action.type).toBe("command");
  });

  it("matches the eight tool names", () => {
    const hook = JSON.parse(readFileSync(file, "utf8")).hooks[0];
    const matcher = new RegExp(hook.matcher);
    for (const name of [
      "fs_write",
      "fsWrite",
      "fs_append",
      "fsAppend",
      "str_replace",
      "strReplace",
      "execute_bash",
      "executeBash",
    ]) {
      expect(matcher.test(name)).toBe(true);
    }
    expect(matcher.test("readFile")).toBe(false);
  });

  it("runs the script from tools/ in hook-stdin mode", () => {
    const command: string = JSON.parse(readFileSync(file, "utf8")).hooks[0].action.command;
    expect(command.startsWith("node --experimental-strip-types tools/")).toBe(true);
    expect(command.endsWith("--hook-stdin")).toBe(true);
  });

  it("holds no unsafe token", () => {
    expect(findUnsafeToken(readFileSync(file, "utf8"))).toBeNull();
  });

  it("leaves out the hook files this spec does not add", () => {
    for (const name of ["test-on-save", "fixture-redact-check", "protocol-codegen"]) {
      expect(existsSync(join(hooksDir, `${name}.json`))).toBe(false);
    }
  });
});

const writeNames = ["fsWrite", "fs_write", "fsAppend", "fs_append", "strReplace", "str_replace"];
const shellNames = ["executeBash", "execute_bash"];

describe.each([
  {
    id: "no-trust-all",
    names: [...writeNames, ...shellNames],
    rejected: ["readFile", "grepSearch", "read_file"],
  },
  {
    id: "no-auto-approve",
    names: writeNames,
    rejected: [...shellNames, "readFile", "grepSearch"],
  },
])("SI hook file $id", ({ id, names, rejected }) => {
  const file = join(hooksDir, `${id}.json`);
  const text = readFileSync(file, "utf8");
  const json = JSON.parse(text);

  it("parses with version v1 and one PreToolUse command hook", () => {
    expect(json.version).toBe("v1");
    expect(json.hooks).toHaveLength(1);
    const hook = json.hooks[0];
    expect(hook.name).toBe(id);
    expect(hook.trigger).toBe("PreToolUse");
    expect(hook.action.type).toBe("command");
  });

  it("matches exactly the expected tool names", () => {
    const matcher = new RegExp(json.hooks[0].matcher);
    for (const name of names) {
      expect(matcher.test(name)).toBe(true);
    }
    for (const name of rejected) {
      expect(matcher.test(name)).toBe(false);
    }
  });

  it("runs its own script from tools/ in hook-stdin mode", () => {
    expect(json.hooks[0].action.command).toBe(
      `node --experimental-strip-types tools/${id}.ts --hook-stdin`,
    );
  });

  it("holds no unsafe token", () => {
    expect(findUnsafeToken(text)).toBeNull();
  });
});

describe(".kiro/hooks folder", () => {
  it("holds only the three expected hook files", () => {
    const files = readdirSync(hooksDir).filter((f) => f.endsWith(".json"));
    expect(files.sort()).toEqual(["no-auto-approve.json", "no-trust-all.json", "secret-scan.json"]);
  });
});
