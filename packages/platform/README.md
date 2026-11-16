# @wraith/platform

Every OS-specific call of Wraith lives in this package (architecture §4.10). It is Node-only: it does not run in Workers or browsers.

Only `apps/node`, `apps/sprite` and `apps/relay-node` may import it.

## Planned contents (P1)

The package currently holds the platform selector and the darwin, linux and win32 adapters. P1 adds six groups of calls:

1. Local IPC, with the 0600 file and 0700 folder checks.
2. Secret-file creation with mode 0600, and the mode check before reading.
3. Login environment capture, and finding a command on PATH.
4. The service unit (launchd, systemd).
5. Process control with signals, killing a process tree, and the sprite's pane-lost signals and exit code 75.
6. Paths, and opening a URL.
