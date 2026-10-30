# Generated eval fixtures

`generateEvalFixtures(spec)` derives offline cases from Spec hard rules:

| Case | Purpose |
|------|---------|
| `acceptance_good` | Positive acceptance — hard rules should pass |
| `counter_promo` | notMatches / promo link must fail |
| `counter_allowlist` | in/list off-allowlist must fail |
| `counter_eq_*` / `counter_neq_*` | eq/neq counterexamples |

Scaffolder (`scaffoldSpec`) returns `{ evals }` alongside a valid Spec. Desk
`handleFreeze` / `handleRun` / `handleEvals` use the same generator — not
Desk-local heuristics.

```ts
import { generateEvalFixtures, runEvals, assertEvalsGate } from "@relay/spec-evals";

const evals = generateEvalFixtures(body);
const report = await runEvals({ spec: body, fixtures: evals });
assertEvalsGate(report); // pre-freeze
```
