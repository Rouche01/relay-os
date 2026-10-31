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

## Cold E2E demo

```bash
pnpm --filter @relay/apps-triage-gen cold-demo
# optional live list:
# GITHUB_TOKEN=… pnpm --filter @relay/apps-triage-gen cold-demo -- --live-github
```

Walkthrough + checklist: [`docs/triage-demo.md`](../../docs/triage-demo.md).

## Using this fixture

1. **Scaffold target** — `intent.md` + `spec.expected.yaml` (authoritative shape).
2. **Validate** — against curated `@relay/services` `github` + `github:default`.
3. **Fixture / shadow** — `fixtures/issues.json` offline; `--live-github` for live list.
4. **E2E** — `cold-demo` / `test` (plan todo `e2e-triage-demo`).

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
