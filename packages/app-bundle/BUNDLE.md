# Relay App bundle

Content-addressed package for a **frozen** Spec v2 that can be exported,
imported, and later installed by Desk (`p2-desk-app-lifecycle`).

## Contents

| Field | Role |
|-------|------|
| `frozen` | Lifecycle Spec (`status: frozen`) |
| `body` | Authoring body (hash source of truth) |
| `specHash` | `hashSpecV2(body)` |
| `lowered` | Manifest + relay block (schedules / outcome entrypoints) |
| `descriptors` | Embedded `ServiceDescriptor`s for `Spec.services` |
| `requiredConnections` | Connection refs (no secrets) |
| `evals` | Offline fixture pack snapshot |
| `trigger` | Spec v2.1 trigger |
| `id` | `rapp_<sha256>` of canonical payload (excludes `id` / `exportedAt`) |

## API

```ts
import {
  buildRelayAppBundle,
  writeRelayAppBundle,
  readRelayAppBundle,
  verifyRelayAppBundle,
} from "@relay/app-bundle";

const bundle = buildRelayAppBundle({
  body,
  services: catalog,
  frozenBy: "operator",
});
writeRelayAppBundle("app.relay.json", bundle);

const imported = readRelayAppBundle("app.relay.json"); // verifies on read
```

Import fails closed when content address, freeze status, or descriptors drift.
