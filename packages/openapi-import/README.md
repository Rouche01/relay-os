# `@relay/openapi-import`

OpenAPI 3 → Relay [`ServiceDescriptor`](../protocol/src/service-descriptor.ts) YAML.

Select operations (GitHub OAS is huge), map auth to `connection: true` slots, mark
write methods `irreversible: true`, and emit YAML that passes the service-descriptor
shape check. Secrets never appear in the output.

## CLI

```bash
pnpm --filter @relay/openapi-import build

pnpm --filter @relay/openapi-import exec relay-openapi-import \
  --input ./fixtures/github-issues.openapi.json \
  --id github \
  --operations issuesListForRepo,issuesCreateComment \
  --out ../../apps/triage-gen/services/github.yaml

# List operationIds without converting
pnpm --filter @relay/openapi-import exec relay-openapi-import \
  --input ./path/to/openapi.json --list
```

| Flag | Purpose |
|------|---------|
| `--operations` | Comma-separated `operationId`s (required unless `--all`) |
| `--tags` | Filter by OpenAPI tag |
| `--all` | Import every operation (avoid on full vendor OAS) |
| `--auth` | `auto` \| `none` \| `bearer` \| `apiKey:Header` |
| `--base-url` | Override `servers[0].url` |

## Library

```ts
import {
  loadOpenApiFile,
  openApiToServiceDescriptor,
  emitServiceDescriptorYaml,
} from "@relay/openapi-import";

const doc = loadOpenApiFile("openapi.json");
const desc = openApiToServiceDescriptor(doc, {
  id: "github",
  operations: ["issuesListForRepo", "issuesCreateComment"],
});
const yaml = emitServiceDescriptorYaml(desc);
```

## GitHub triage fixture

`fixtures/github-issues.openapi.json` is a **trimmed** OpenAPI excerpt matching the
real GitHub REST shapes for the two ops triage-gen needs. Regenerate Desk YAML:

```bash
pnpm --filter @relay/openapi-import run gen:github-triage
```

For a full vendor file, download GitHub’s OAS and pass `--operations` explicitly —
never `--all`.
