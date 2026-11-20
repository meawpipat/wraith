import type { ClaudeLaunchView } from "../../lib/claude-launch.ts";

export interface FakeClaudeSdk {
  /** Options received by each `query` call, by reference. */
  readonly received: ClaudeLaunchView[];
  query(options: ClaudeLaunchView): void;
}

/** Fake Claude SDK: records the options it is given and runs nothing. */
export function makeFakeClaudeSdk(): FakeClaudeSdk {
  const received: ClaudeLaunchView[] = [];
  return {
    received,
    query(options) {
      received.push(options);
    },
  };
}
