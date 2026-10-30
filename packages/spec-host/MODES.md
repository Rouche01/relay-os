# Spec host run modes

| Mode | Network | Irreversible writes | LLM | HITL default |
|------|---------|---------------------|-----|--------------|
| `fixture` | blocked | simulated (or fixture) | explicit stub/client | auto-approve |
| `shadow` | **live reads** | **always simulated** + evidence `shadowWrite` | live (env) or explicit | wait for human |
| `live` | live | real — requires `budget.dryRun: false` | live (env) or explicit | wait for human |

## Shadow

```ts
await runSpec({
  body,
  services,
  mode: "shadow",
  connectionStore: createEnvConnectionStore(),
  // llmClient optional → createLiveLlmClient() from LLM_PROVIDER + API key
});
```

GET/HEAD/OPTIONS hit the network. POST/PUT/PATCH/DELETE return `dryRunSimulated` bodies and evidence with `shadowWrite: true`.

## Live

```ts
await runSpec({
  body: { ...body, budget: { ...body.budget, dryRun: false } },
  mode: "live",
  connectionStore,
  hitl: { autoApprove: false }, // default for live
});
```

Fails closed if `budget.dryRun` is not `false`. Spec should still put `human.*` before irreversible steps (validator).

## Fixture (CI)

Pass `apiFixtures` + stub `llmClient`; network stays blocked.
