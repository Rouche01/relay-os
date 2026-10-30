# Browser / computer fallback engines

Spec catalog verbs `browser.*` and `computer.*` are wired through
`buildSpecEngines` into workflow-runtime.

## Default (fixture)

When `fallbackEngines` is not `false` (default), missing `browser` / `computer`
keys get offline fixtures:

| Verb | Behavior |
|------|----------|
| `browser.navigate` / `read` / `click` / `type` | In-memory; no Playwright |
| `browser.submit` | Simulated when `dryRun` → `dryRunSimulated` + evidence `shadowWrite` |
| `computer.observe` | Fixture screenshot payload |
| `computer.act` | Simulated when `dryRun` |

HITL before irreversible verbs is still enforced by the validator
(`requiresHitlWhenIrreversible` on submit / act).

```ts
await runSpec({
  body, // steps using browser.navigate … human.approve … browser.submit
  services: [],
  llmClient: stub,
  mode: "fixture",
  hitl: { autoApprove: true },
  // browser + computer fixtures installed automatically
});
```

## Live / shadow

Pass real engines via `extraEngines` (they replace fixtures):

```ts
import { PlaywrightEngine } from "@relay/engines-browser";
import { ComputerEngine } from "@relay/engines-computer";

await runSpec({
  body,
  mode: "shadow",
  extraEngines: {
    browser: new PlaywrightEngine({ headless: true }),
    computer: new ComputerEngine({ baseUrl: process.env.COMPUTER_URL! }),
  },
});
```

Note: live Playwright/Computer action type names may differ from Spec verbs
(`input` vs `type`, `screenshot` vs `observe`). Prefer Spec-verb adapters or
fixtures until those packages expose catalog-aligned wrappers.

## Disable

```ts
await runSpec({ body, services, fallbackEngines: false, … });
// Specs with browser.* then fail: "requires engine browser"
```
