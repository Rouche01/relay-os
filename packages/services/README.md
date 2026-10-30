# `@relay/services`

Curated [`ServiceDescriptor`](../protocol/src/service-descriptor.ts) pack for Spec v2
`api.request`. Not app-local — Desk, scaffolder, and `@relay/spec-host` callers load
from here.

| id | Auth | Purpose |
|----|------|---------|
| `reddit-public` | bearer `reddit:default` | Read listings |
| `reddit-oauth` | bearer `reddit:default` | Comment write |
| `github` | bearer `github:default` | Issues list + comment (OpenAPI-imported) |
| `slack` | bearer `slack:default` | chat.postMessage + history |
| `http-fetch` | none | Generic absolute-URL GET |
| `rss` | none | Fetch RSS/Atom by URL |
| `notion` | bearer `notion:default` | Search + create comment |

## Usage

```ts
import {
  loadCuratedServices,
  loadCuratedService,
  curatedKnownConnections,
} from "@relay/services";

const catalog = loadCuratedServices();
const github = loadCuratedService("github");
const knownConnections = curatedKnownConnections();
```

YAML lives in [`descriptors/`](./descriptors/). Regenerate GitHub:

```bash
pnpm --filter @relay/openapi-import run gen:github-triage
```
