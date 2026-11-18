export type SpikeId =
  | "q1"
  | "q2"
  | "q6"
  | "q12"
  | "q13"
  | "q14"
  | "q3"
  | "q3b"
  | "q4"
  | "q7"
  | "q10"
  | "q11"
  | "q23"
  | "q30"
  | "q31"
  | "q32"
  | "q33"
  | "q35"
  | "q43";

export type SpikeDir = "hc" | "kiro" | "agents";

/** Every spike the owner list names (19). */
export const OWNER_LIST: readonly SpikeId[] = [
  "q1",
  "q2",
  "q6",
  "q12",
  "q13",
  "q14",
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

/** The P0-D4 gate list: OWNER_LIST without q14 (18). */
export const GATE_LIST: readonly SpikeId[] = OWNER_LIST.filter((id) => id !== "q14");

const HC_IDS: ReadonlySet<SpikeId> = new Set<SpikeId>(["q1", "q2", "q6", "q12", "q13", "q14"]);
const AGENTS_IDS: ReadonlySet<SpikeId> = new Set<SpikeId>(["q33", "q35"]);

/** Repo-relative posix paths of a spike's folder, script and evidence root. */
export function locate(id: SpikeId): { dir: SpikeDir; script: string; evidenceRoot: string } {
  const dir: SpikeDir = HC_IDS.has(id) ? "hc" : AGENTS_IDS.has(id) ? "agents" : "kiro";
  return {
    dir,
    script: `spike/${dir}/${id}/${id}.ts`,
    evidenceRoot: `spike/${dir}/${id}/evidence`,
  };
}
