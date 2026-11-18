import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

export const NODE_SHEBANG = "#!/usr/bin/env node\n";

/**
 * Writes each fake as an executable Node script in a fresh temp folder and runs `fn`
 * with an env whose PATH is that folder plus the folder of `process.execPath`.
 * The folder is removed in `finally`. `files` maps a binary name to its script body
 * (the shebang line is added here).
 */
export async function withBinDir<T>(
  files: Readonly<Record<string, string>>,
  fn: (env: Record<string, string>, dir: string) => Promise<T> | T,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "wraith-bin-"));
  try {
    for (const [name, body] of Object.entries(files)) {
      const file = join(dir, name);
      await writeFile(file, body.startsWith("#!") ? body : NODE_SHEBANG + body, { mode: 0o755 });
      await chmod(file, 0o755);
    }
    return await fn({ PATH: [dir, dirname(process.execPath)].join(delimiter) }, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
