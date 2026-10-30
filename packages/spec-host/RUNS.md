# Spec run store (Desk history)

Runs are persisted as `SpecRunCheckpoint` records, keyed by **`runId`**, and
queryable by **`specId`** / **`specHash`**.

## What is stored

- status (`waiting_you` | `complete` | `aborted` | `failed` | …)
- timestamps (`createdAt`, `updatedAt`)
- evidence pack + `stepOutputs`
- HITL decisions (`hitlDecisions[]`)
- frozen Spec + body (for **replay**)

Secrets are never stored — only connection refs on the Spec.

## Hosts

```ts
const store = createFileRunStateStore(".data/spec-runs");

await runSpec({
  body,
  services,
  connectionStore,
  hitl: { autoApprove: true, runStateStore: store }, // persists terminal runs too
});

const rows = await listRunSummaries(store, { specId: "specv2_…" });
const full = await store.get(rows[0]!.runId);

await replaySpecRun({
  runId: full!.runId,
  runStateStore: store,
  services,
  connectionStore,
  llmClient: stub,
  mode: "fixture",
  hitl: { autoApprove: true, runStateStore: store },
});
```

## Desk HTTP (relay-shell)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v2/runs?specId=&specHash=&status=&limit=` | List summaries |
| GET | `/api/v2/runs/:runId` | Full checkpoint |
| POST | `/api/v2/runs/:runId/replay` | Re-run frozen Spec (fixture) |
| POST | `/api/v2/runs/:runId/resume` | HITL proceed/abort/retry |
