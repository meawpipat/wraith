# Q12: does hc say who sent input?

**Question.** When a second client types into a pane with `hc send`, does any event name the pane
and the sending client? The expected result is `FAIL`, with the branch "drop `herdr-guard`, keep
the limitation in §12" (R13.9).

**How to run.** Stage 1, after Q2 (the loop runs it; no agent, no credits):

```
pnpm spike q12
pnpm spike record q12
```

It starts one background pane in the Test_Core, follows `hc events` for a short window, sends a
marker with `hc send` from a second child, and stops the pane again.

**Human steps.** None.

**What to read in the evidence.**
- `summary.json`: counts, whether an event names the pane, and the sender field if one was found.
- `events-shape.json`: key paths of the first events (no values).
- `index.json`: the verdict and the criteria.

The raw event log stays in the Spike_Root (`q12-events.raw.log`, mode 0600) and is removed with it.

`sender.ts` holds the pure `findSenderField(events)` and the verdict mapping. The `hc run` form
that starts the pane is a guess until Q2 records the real one (`PANE_ARGV` in `q12.ts`).
