import { ProgrammerError } from "./errors.js";
import { getRandomValuesFn } from "./webcrypto.js";

const MAX_RANDOM_BYTES = 65536;

/** `n` random bytes from the platform CSPRNG; `n` is an integer from 0 to 65536. */
export function randomBytes(n: number): Uint8Array {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_RANDOM_BYTES) {
    throw new ProgrammerError("invalid_argument");
  }
  const fill = getRandomValuesFn();
  const out = new Uint8Array(n);
  if (n === 0) return out;
  try {
    fill(out);
  } catch {
    throw new ProgrammerError("webcrypto_failed");
  }
  return out;
}
