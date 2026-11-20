import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { findUnsafeToken } from "../../tools/lib/unsafe-tokens.ts";
import type { OwnMarker } from "./own-marker.ts";

/** 🧪 Working names, unverified until Q43, Q32 and Q31 evidence confirms them. */
export const READ_ONLY_TOOLS: readonly string[] = ["fs_read", "grep", "glob", "code"];

/** 🧪 Tool names that write or execute; never pre-approved. */
const MUTATING_TOOLS: readonly string[] = ["fs_write", "execute_bash", "shell", "write", "use_aws"];

const NAME_RE = /^wraith-spike-[a-z0-9]+$/;

export interface ProfileOptions {
  q: string;
  prompt: string;
  hook?: { command: string; matcher: string };
  writeAllowedPaths?: string[];
}

/** Builds the profile object. Pre-approved tools come from READ_ONLY_TOOLS only (A5). */
export function buildKiroProfile(o: ProfileOptions): Record<string, unknown> {
  const profile: Record<string, unknown> = {
    name: `wraith-spike-${o.q}`,
    description: `Wraith spike ${o.q} (throwaway)`,
    prompt: o.prompt,
    tools: [...READ_ONLY_TOOLS],
    allowedTools: [...READ_ONLY_TOOLS],
  };
  if (o.hook !== undefined && o.q === "q3b") {
    profile.hooks = { preToolUse: [{ matcher: o.hook.matcher, command: o.hook.command }] };
  }
  if (o.writeAllowedPaths !== undefined && o.writeAllowedPaths.length > 0) {
    // The write tool is listed under toolsSettings only; it is never in allowedTools.
    profile.toolsSettings = { fs_write: { allowedPaths: [...o.writeAllowedPaths] } };
  }
  return profile;
}

/** Throws on any violation of the safe-profile rules. */
export function assertSafeProfile(p: unknown): void {
  if (typeof p !== "object" || p === null || Array.isArray(p)) {
    throw new Error("profile must be an object");
  }
  const r = p as Record<string, unknown>;
  const name = r.name;
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new Error("profile name must match wraith-spike-<q>");
  }
  const allowed = r.allowedTools;
  if (!Array.isArray(allowed)) throw new Error("allowedTools must be a list");
  for (const t of allowed) {
    if (typeof t !== "string") throw new Error("allowedTools entries must be strings");
    if (t.includes("*")) throw new Error("allowedTools must hold no wildcard");
    if (MUTATING_TOOLS.includes(t)) throw new Error("a write or execute tool is pre-approved");
    if (!READ_ONLY_TOOLS.includes(t)) throw new Error("allowedTools must be read-only tools");
  }
  const json = JSON.stringify(p);
  // Also scan with JSON string escapes of quotes undone, so a quoted value in a string field is seen.
  if (findUnsafeToken(json) !== null || findUnsafeToken(json.replace(/\\"/g, '"')) !== null) {
    throw new Error("profile holds an unsafe token");
  }
  if (r.hooks !== undefined && name !== "wraith-spike-q3b") {
    throw new Error("hooks are allowed only for q3b");
  }
}

/** Scratch `.kiro/agents/` first, home as the fallback; Q32 always uses home. */
export function profilePlacement(
  q: string,
  scratch: string,
  qs43: "scratch" | "home" | "unknown",
  home: string = process.env.HOME ?? "",
): { path: string; kind: "scratch" | "home" } {
  const file = `wraith-spike-${q}.json`;
  if (q === "q32" || qs43 === "home") {
    return { path: join(home, ".kiro", "agents", file), kind: "home" };
  }
  return { path: join(scratch, ".kiro", "agents", file), kind: "scratch" };
}

/**
 * Writes the profile with flag `wx` (an existing file is never overwritten),
 * records the path in the marker, and refuses any other file name.
 */
export function writeProfileFile(
  q: string,
  profile: Record<string, unknown>,
  path: string,
  marker: OwnMarker,
): void {
  const abs = resolve(path);
  if (basename(abs) !== `wraith-spike-${q}.json`) {
    throw new Error("refusing to write a file other than wraith-spike-<q>.json");
  }
  if (!dirname(abs).endsWith(join(".kiro", "agents"))) {
    throw new Error("refusing to write outside a .kiro/agents folder");
  }
  if (profile.name !== `wraith-spike-${q}`) throw new Error("profile name does not match q");
  assertSafeProfile(profile);
  mkdirSync(dirname(abs), { recursive: true });
  const fd = openSync(abs, "wx", 0o600);
  try {
    writeSync(fd, `${JSON.stringify(profile, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }
  marker.agentFiles.push({ path: abs, created: true });
}
