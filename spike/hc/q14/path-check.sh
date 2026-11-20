#!/bin/sh
# Q14 helper: run this in a pane YOU created. It only asks the shell where kiro-cli is; it never runs it.
if found=$(command -v kiro-cli); then
  echo "kiro-cli resolves: $found"
else
  echo "kiro-cli does NOT resolve on this PATH"
  exit 1
fi
