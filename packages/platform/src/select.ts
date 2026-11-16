import { darwin } from "./darwin.js";
import { ProgrammerError } from "./errors.js";
import { linux } from "./linux.js";
import type { Platform } from "./platform.js";
import { win32 } from "./win32.js";

export function selectPlatform(platform: string = process.platform): Platform {
  switch (platform) {
    case "darwin":
      return darwin;
    case "linux":
      return linux;
    case "win32":
      return win32;
    default:
      throw new ProgrammerError("unsupported_platform", platform);
  }
}
