# Spec v2.1 `once`

Idempotency key per step. When set, the workflow runtime skips the step if
the key was already **committed** in the data store (across runs / schedule
ticks).

```yaml
steps:
  - id: post
    use: api.request
    forEach: "${steps.draft.output}"
    once: "${item.issue_number}"
    args: { ... }
```

## Rules

- `once` must be a whole-string `${...}` ref (usually `${item.*}` under `forEach`).
- Validator **requires** `once` on irreversible `forEach` steps when
  `trigger` is `schedule` or `poll`.
- Keys live in store `relay.once` as `{specHash}:{stepId}:{resolvedKey}`.
- Committed only after a successful execute that is **not**
  `dryRunSimulated` (shadow/fixture simulated writes do not consume the key).

## Durable store

Default data engine is in-memory (run-local). For schedule/poll apps pass a
shared store:

```ts
import { createFileJsonDataStore } from "@relay/engines-data";
import { runSpec } from "@relay/spec-host";

await runSpec({
  body,
  services,
  dataStore: createFileJsonDataStore({ path: ".data/spec-data.json" }),
  mode: "live",
  // ...
});
```
