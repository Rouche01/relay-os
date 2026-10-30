# Spec host HITL (pause / resume)

## Defaults

| Mode | `autoApprove` | Behavior |
|------|---------------|----------|
| `fixture` | true | Auto-proceed (CI) |
| `shadow` / `live` | false | Real HITL |

When `autoApprove` is false and no `adapter` / `onFeedbackRequested` is set,
**`pauseAndReturn` defaults to true**: the run persists a checkpoint and returns
`WAITING_USER` instead of hanging.

## Pause + resume (cross-process)

```ts
const store = createMemoryRunStateStore(); // or createFileRunStateStore(dir)

const paused = await runSpec({
  body,
  services,
  connectionStore,
  mode: "shadow",
  hitl: {
    autoApprove: false,
    pauseAndReturn: true,
    runStateStore: store,
  },
});
// paused.state === "WAITING_USER"
// paused.checkpoint / paused.pendingFeedback for Desk / Telegram

const done = await resumeSpec({
  runId: paused.runId!,
  runStateStore: store,
  feedback: { action: "proceed", value: true }, // or abort / edit string
  services,
  connectionStore,
});
```

## Feedback Broker adapter

```ts
await runSpec({
  ...,
  hitl: {
    autoApprove: false,
    adapter: cliAdapter, // or Telegram / Desk Console adapter
  },
});
// Blocks until the adapter returns; attaches @relay/feedback-broker.
```

## Same-process

After `pauseAndReturn`, the returned `runtime` is still `WAITING_USER`. You can
also call `runtime.provideFeedback({ requestId, agentId, action: "proceed" })`
without going through `resumeSpec` (no process restart).
