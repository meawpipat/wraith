/** A RESULTS.md fixture with the three table layouts and no `## Entries` section. */
export const RESULTS_SAMPLE = `# Spike results

Intro text.

| Q | group | runner | result (pass/fail) | evidence | branch chosen | date |
|---|---|---|---|---|---|---|
| Q1 | A | see §19 | pending · pre-check 2026-11-05: \`terminal.read\` is plain text; cost pending | | | |
| Q3 | B | see §19 | pending | | | |
| Q3b | B | see §19 | pending | | | |
| Q8 | C | see §19 | pass (user has Kiro Pro; credits requested) | | | |

## Group H — Local hardware approver
| Q | status | result | evidence | branch |
|---|---|---|---|---|
| Q29 Secure Enclave + Touch ID | todo | | | |

## Group J — Agent drivers
| Q | result (pass/fail) | evidence | branch chosen | date |
|---|---|---|---|---|
| Q35 Agents advertise commands | todo | | | |
| Q43 Kiro V3 agent flag | todo | | | |

## Notes
Closing text.
`;

export const SAMPLE_IDS = ["Q1", "Q3", "Q3b", "Q29", "Q35", "Q43"] as const;
