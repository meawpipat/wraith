import { scan } from "../../packages/protocol/scripts/check-boundaries.ts";

/** Same offsets as `src`, comments blanked, string and template content kept (D2). */
export const maskComments = (src: string): string => scan(src).noComments;
