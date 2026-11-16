import type { LinuxPlatform } from "./platform.js";

export const linux: LinuxPlatform = Object.freeze({
  id: "linux",
  // P0: no detection yet (R9.10).
  isWsl: (): boolean => false,
});
