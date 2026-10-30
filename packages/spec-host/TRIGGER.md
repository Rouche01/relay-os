# Spec v2.1 `trigger`

Optional authoring field on Spec bodies. Exactly one of:

```yaml
trigger:
  manual: true
# or
trigger:
  schedule:
    cron: "0 9 * * 1-5"
    timezone: Europe/London   # optional
# or
trigger:
  poll:
    everyMs: 60000
    sourceStep: scout
```

## Lowering

`lowerSpecV2` emits `manifest.schedules` for schedule/poll (id `spec`,
entrypoint `default`). Manual / omitted → no schedules.

## Scheduler

```ts
import {
  schedulerHostFromSpec,
  createRunSpecInvoker,
} from "@relay/spec-host";

const host = schedulerHostFromSpec({
  body,
  dataDir: ".data",
  invoke: createRunSpecInvoker({
    body,
    services,
    connectionStore,
    mode: "shadow",
    hitl: { autoApprove: false, runStateStore },
  }),
});
await host.start();
```
