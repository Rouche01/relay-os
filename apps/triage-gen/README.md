# triage-gen — forcing-function acceptance fixture

Acceptance fixture for [`relay_spec_to_working_app.plan.md`](../../.cursor/plans/relay_spec_to_working_app.plan.md) todo **`h0-forcing-intent`**.

**Not a per-app runner.** There is no `host.ts` here on purpose — execution goes
through generic [`@relay/spec-host`](../../packages/spec-host) once connections
and GitHub reach land (h2+). This package locks the **intent**, **success bar**,
**expected Spec shape**, and a **minimal GitHub service descriptor**.

## Intent (one line)

> Weekdays 09:00 → open `bug` issues in `acme/widgets` → draft triage comment →
> human approve → post once per issue.

Full text + slots: [`intent.md`](./intent.md). Success bar: [`SUCCESS.md`](./SUCCESS.md).

## Why this vertical

| Need | How triage exercises it |
|------|-------------------------|
| Non-Reddit reach | GitHub REST via `@relay/services` (`github`) |
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
services/README.md     Points at packages/services/descriptors/github.yaml
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

## Regenerate GitHub descriptor

Canonical file: [`packages/services/descriptors/github.yaml`](../../packages/services/descriptors/github.yaml).

```bash
pnpm --filter @relay/openapi-import build
pnpm --filter @relay/openapi-import run gen:github-triage
```

Source OAS excerpt: [`packages/openapi-import/fixtures/github-issues.openapi.json`](../../packages/openapi-import/fixtures/github-issues.openapi.json).

## Non-goals

- Implementing a triage host or CLI here
- Full GitHub OpenAPI surface (only list + comment)
- Shipping outcome metric automation in this package
