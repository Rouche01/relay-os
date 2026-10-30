# Spec connections (secrets stay off the Spec)

Specs reference connections by id (`github:default`, `reddit:default`).  
`@relay/spec-host` resolves them through a pluggable **`ConnectionStore`**.

## Backends

| Store | Use |
|-------|-----|
| `MemoryConnectionStore` | Tests, Desk/engager fixture dry-run |
| `FileJsonConnectionStore` | JSON file (prefer `env:VAR` values) |
| `EnvConnectionStore` | `RELAY_CONNECTIONS_FILE` or `RELAY_CONNECTIONS` JSON, or explicit `map` |
| `KeychainConnectionStore` | macOS Keychain (`security` CLI) |
| `CompositeConnectionStore` | Layer memory → file → env → keychain |

## File / env JSON shape

See [`connections.example.json`](./connections.example.json):

```bash
export GITHUB_TOKEN=ghp_…
export RELAY_CONNECTIONS_FILE=/path/to/connections.json
```

Or inline:

```bash
export RELAY_CONNECTIONS='{"github:default":{"type":"bearer","token":"env:GITHUB_TOKEN"}}'
```

## Host usage

```ts
await runSpec({
  body,
  services,
  connectionStore: createEnvConnectionStore(),
  llmClient,
  // knownConnections derived from store; missing refs → SpecHostError code missing_connection
});
```

Specs must never embed tokens. Validator `knownConnections` comes from `store.listIds()` when a store is passed.
