import type { Win32Platform } from "./platform.js";

export const WSL2_DOCS_URL = "docs/wsl2.md";

export const WIN32_NOTICE = `Native Windows is not supported yet. Run Wraith inside WSL2: ${WSL2_DOCS_URL}`;

export const win32: Win32Platform = Object.freeze({
  id: "win32",
  notice: WIN32_NOTICE,
  exitCode: 1,
});
