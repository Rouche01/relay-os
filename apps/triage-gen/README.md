# triage-gen — forcing-function acceptance fixture

Acceptance fixture for [`relay_spec_to_working_app.plan.md`](../../.cursor/plans/relay_spec_to_working_app.plan.md) todo **`h0-forcing-intent`**.

**Not a runnable Spec host.** There is no `host.ts` here on purpose — the plan’s
north star is one generic `@relay/spec-host`, not another per-app runner.
This package locks the **intent**, **success bar**, **expected Spec shape**, and
a **minimal GitHub service descriptor** so later phases have a concrete target.

## Intent (one line)

> Weekdays 09:00 → open `bug` issues in `acme/widgets` → draft triage comment →
> human approve → post once per issue.

Full text + slots: [`intent.md`](./intent.md). Success bar: [`SUCCESS.md`](./SUCCESS.md).

## Why this vertical

| Need | How triage exercises it |
|------|-------------------------|
| Non-Reddit reach | GitHub REST via `services/github.yaml` |
| Real connection | `github:default` (secrets outside Spec) |
| Schedule | `trigger.schedule.cron: "0 9 * * 1-5"` (Spec v2.1) |
| Idempotency | `once` on issue number (Spec v2.1) |
| HITL + resume | `human.approve` before irreversible comment |
| Generic host | Zero GitHub-specific code outside the descriptor |

## Files

```text
intent.md              Locked NL intent + slots
SUCCESS.md             Acceptance bar + E2E checklist (later)
spec.expected.yaml     Target Spec (v2.1 fields annotated)
services/github.yaml   Hand descriptor until OpenAPI import (r1)
fixtures/issues.json   Offline scout payload
```

## Using this fixture (later phases)

1. **Scaffold target** — feed `intent.md` to `@relay/spec-scaffold` once `github`
   is on the known-services list; compare to `spec.expected.yaml`.
2. **Validate (v2 subset)** — strip or ignore `trigger` / `once` / `retry` until
   Spec v2.1 lands; validate steps against `services/github.yaml`.
3. **Fixture / shadow runs** — `fixtures/issues.json` seeds scout; live GitHub
   when connection + host modes exist (`h3`).
4. **E2E** — plan todo `e2e-triage-demo`.

## Non-goals

- Implementing a triage host or CLI here
- Full GitHub OpenAPI surface (only list + comment)
- Shipping outcome metric automation in this package
