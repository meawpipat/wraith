/**
 * The 18 P0-D4 gate ids (the owner list without q14). The dependency direction is
 * spike -> tools, so tools keeps its own copy; `spike/test/gate-list.test.ts`
 * asserts that it equals `spike/lib/ids.ts`.
 */
export const GATE_LIST: readonly string[] = [
  "q1",
  "q2",
  "q6",
  "q12",
  "q13",
  "q3",
  "q3b",
  "q4",
  "q7",
  "q10",
  "q11",
  "q23",
  "q30",
  "q31",
  "q32",
  "q33",
  "q35",
  "q43",
];
