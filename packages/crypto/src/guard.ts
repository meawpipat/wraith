/**
 * Runs a verification body and turns every throw, rejection or non-`true`
 * result into `false`. Binds nothing and logs nothing.
 */
export async function failClosed(run: () => Promise<boolean> | boolean): Promise<boolean> {
  try {
    return (await run()) === true;
  } catch {
    return false;
  }
}

/** Object that is not null and not an array. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Record whose prototype is Object.prototype or null. */
export function isPlainRecord(v: unknown): v is Record<string, unknown> {
  if (!isRecord(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
