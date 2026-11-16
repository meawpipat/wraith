export type PlatformId = "darwin" | "linux" | "win32";

export interface PlatformBase {
  readonly id: PlatformId;
}

export interface DarwinPlatform extends PlatformBase {
  readonly id: "darwin";
}

export interface LinuxPlatform extends PlatformBase {
  readonly id: "linux";
  isWsl(): boolean;
}

export interface Win32Platform extends PlatformBase {
  readonly id: "win32";
  readonly notice: string;
  readonly exitCode: 1;
}

export type Platform = DarwinPlatform | LinuxPlatform | Win32Platform;
