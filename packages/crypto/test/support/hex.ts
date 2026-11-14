const HEX_PATTERN = /^(?:[0-9a-f]{2})*$/;

/** Lower-case hex text to bytes. Throws on odd length, upper case or any non-hex character. */
export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== "string" || !HEX_PATTERN.test(hex)) {
    throw new Error("invalid hex text: expected an even number of lower-case hex digits");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Bytes to lower-case hex text. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}
