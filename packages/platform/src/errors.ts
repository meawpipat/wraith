export type ProgrammerReason = "unsupported_platform";

const SAFE_PLATFORM = /^[A-Za-z0-9_-]{1,32}$/;

/** Thrown for a caller bug. Own copy: this package has no workspace dependency (D11). */
export class ProgrammerError extends Error {
  readonly reason: ProgrammerReason;
  readonly platform: string;

  constructor(reason: ProgrammerReason, platform: string) {
    const safe = SAFE_PLATFORM.test(platform) ? platform : "<invalid>";
    super(`wraith-platform: unsupported platform ${safe}`);
    this.name = "ProgrammerError";
    this.reason = reason;
    this.platform = safe;
  }
}
