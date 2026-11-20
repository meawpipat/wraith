# Third-party code and tools

| Name | Use | License | Notes |
|---|---|---|---|
| herdr-core (`hc`) | Terminal/pane runtime for every bot (runtime dependency, not vendored; DECISION-58) | Apache-2.0 | https://github.com/herdrdev/herdr-core |
| Kiro CLI (`kiro-cli`) | Agent runtime (ACP) | Kiro terms | https://kiro.dev |
| Agent Client Protocol SDK (`@agentclientprotocol/sdk` 2.8.0) | ACP client for spike Q10; dependency of `@wraith/spike` only, not shipped | Apache-2.0 | https://agentclientprotocol.com |
| Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) | Claude bot driver, sprite `--mode sdk` (DECISION-47) — **pending H11**, not bundled | Anthropic terms (not permissive) | https://code.claude.com/docs/en/agent-sdk |
| Grok Build CLI (`grok`) | Optional agent (DECISION-48), runtime dependency on the user's machine | xAI terms | https://docs.x.ai/build/overview |
| Poppins (font) | UI typeface (bundle the woff2 files; do not hotlink in the desktop app) | SIL OFL 1.1 | https://fonts.google.com/specimen/Poppins |
| JetBrains Mono (font) | Code and terminal typeface | SIL OFL 1.1 | https://www.jetbrains.com/lp/mono/ |
| `yaml` 2.9.1 | Parses `ci.yml` in the structure test; dev dependency of `@wraith/tools` only, not shipped | ISC | https://github.com/eemeli/yaml |

Update this file whenever a dependency with notable licensing or vendored code is added.
