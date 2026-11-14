# @wraith/crypto

JCS canonical JSON, ECDSA P-256 sign/verify, HMAC, hashing; byte-identical across Node, Workers, browsers (§6.1).

See `docs/architecture.md` (section noted), `.kiro/specs/` for requirements and `.kiro/steering/` for rules.

## Rules

- This package depends on `@wraith/protocol` (through the bare specifier only) and never stores keys; callers hold key material and pass it in.
