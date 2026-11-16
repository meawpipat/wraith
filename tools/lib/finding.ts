export const EXIT_OK = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_ERROR = 2;

/** A finding has no field that can hold matched text, by design. */
export interface Finding {
  /** Repo-relative path, posix separators. */
  readonly file: string;
  /** 1-based line. */
  readonly line: number;
  /** 1-based column, only for the Platform_Check. */
  readonly column?: number;
  /** Stable rule id, for example "secret/github-token". */
  readonly rule: string;
}

export function formatFinding(f: Finding): string {
  const where = f.column === undefined ? `${f.file}:${f.line}` : `${f.file}:${f.line}:${f.column}`;
  return `${where} ${f.rule}`;
}

/** Fixed message plus an optional path. Never carries file content. */
export class ToolError extends Error {
  readonly path?: string;

  constructor(message: string, path?: string) {
    super(message);
    this.name = "ToolError";
    if (path !== undefined) this.path = path;
  }
}
