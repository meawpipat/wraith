export type EnvProfile = "hc" | "agent" | "listener" | "tool";

export interface EnvInput {
  base: Readonly<Record<string, string | undefined>>;
  profile: EnvProfile;
  session?: string;
  root?: string;
  extraPass?: readonly string[];
}

export const BASE_PASS: readonly string[] = ["PATH", "HOME", "LANG", "TERM", "TMPDIR"];

/** True for names that belong to herdr-core panes: `HC_*` and `HERDR_*`. */
export function isPaneEnvName(name: string): boolean {
  return name.startsWith("HC_") || name.startsWith("HERDR_");
}

function has(base: Readonly<Record<string, string | undefined>>, name: string): boolean {
  return Object.hasOwn(base, name) && typeof base[name] === "string";
}

/**
 * Builds a child environment from an empty object. Never logs, never prints a value.
 */
export function buildChildEnv(i: EnvInput): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of BASE_PASS) {
    const v = has(i.base, name) ? i.base[name] : undefined;
    if (v !== undefined) out[name] = v;
  }
  if (i.profile === "hc") {
    if (!i.session || !i.root) throw new Error("buildChildEnv: profile hc needs session and root");
    out.HC_SESSION = i.session;
    out.XDG_STATE_HOME = `${i.root}/s`;
    out.XDG_CONFIG_HOME = `${i.root}/c`;
  } else if (i.profile === "agent") {
    for (const name of i.extraPass ?? []) {
      if (isPaneEnvName(name) || name.startsWith("XDG_")) continue;
      const v = has(i.base, name) ? i.base[name] : undefined;
      if (v !== undefined) out[name] = v;
    }
  }
  return out;
}
