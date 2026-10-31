# Outcome follow-ups

Spec `kind: outcome` rules declare deferred metrics (`metric.name` + `metric.after`).
They are **not** enforced during the primary run — the host schedules follow-ups.

## Authoring

```yaml
rules:
  - id: maintainer_ack
    kind: outcome
    metric:
      name: issue_reaction_or_reply
      after: 72h
      min: 1
```

`after` accepts `48h`, `7d`, `30m`, `90s`, `500ms`, or an integer millisecond string.

## Lowering

Each outcome rule becomes:

| Manifest field | Value |
|----------------|--------|
| `entrypoints.outcome_<ruleId>` | Single `engine: none` stage (host-handled) |
| `schedules[].id` | `outcome_<ruleId>` |
| `schedules[].every_ms` | `parseDurationMs(after)` |

Primary `trigger.schedule` / `poll` schedules remain on entrypoint `default`.

## Run store

On **complete**, `runSpec` / `resumeSpec` enqueue pending `outcomeFollowUps` on the
checkpoint (`dueAt = completedAt + after`).

When the scheduler fires `outcome_<ruleId>`, `createHostScheduleInvoker` calls
`processDueOutcomeFollowUps` — measures due rows and writes `result` (`value`,
`passed` vs min/max, `detail`).

Optional `rememberOutcome` / VoltMem writers fail open.

## Host wiring

```ts
import {
  createHostScheduleInvoker,
  enableSpecScheduler,
} from "@relay/spec-host";

const invoke = createHostScheduleInvoker({
  body,
  services,
  connectionStore,
  runStateStore: store,
  mode: "shadow",
  measureOutcome: async (followUp) => ({ value: 1 }), // app-specific
});

const { host } = await enableSpecScheduler({
  body,
  dataDir: ".data",
  invoke,
  runStateStore: store,
});
```

Desk: run Summary shows follow-ups; `POST /api/v2/outcomes/process` forces a sweep.
