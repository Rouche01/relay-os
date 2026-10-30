# Service descriptors (triage-gen)

Canonical descriptors live in **`@relay/services`**
([`packages/services/descriptors/`](../../../packages/services/descriptors/)).

Triage uses **`github`** from that pack (OpenAPI-imported). Do not add
app-local YAML here — regenerate with:

```bash
pnpm --filter @relay/openapi-import run gen:github-triage
```
