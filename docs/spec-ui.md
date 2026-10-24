# Spec governance (Relay shell)

App-agnostic Intent → Spec **Approve / Abort**. Not owned by CommunityEngager.

| Piece | Location |
|-------|----------|
| Spec store | [`@relay/spec-store`](../packages/spec-store) — `{RELAY_DATA_DIR\|\|.data}/specs.json` |
| API | [`apps/relay-shell/server/api.ts`](../apps/relay-shell/server/api.ts) |
| UI | [`apps/relay-shell`](../apps/relay-shell) — Specs list, Spec review, New from Intent |
| Design | [Flowstep · Relay Spec](https://app.flowstep.ai/file?activeFileId=c2f134d4-1f9d-4c8c-975d-4b6baef2eeb4) |

Domain packs (e.g. `community-engager/engage`) stay in their apps. The shell’s “New from Intent” uses the generic `relay/compose` pack (primitives only).

## Run

```bash
# Terminal A — Spec API
pnpm --filter @relay/protocol build
pnpm --filter @relay/spec-store build
pnpm --filter @relay/apps-relay-shell api

# Terminal B — Preact shell (proxies /api → :8790)
pnpm --filter @relay/apps-relay-shell dev
```

- API: http://127.0.0.1:8790  
- UI: http://127.0.0.1:5173  

| Env | Default |
|-----|---------|
| `SPEC_UI_HOST` / `SPEC_UI_PORT` | `127.0.0.1` / `8790` |
| `RELAY_DATA_DIR` | `.data` (cwd) |

## API

- `GET /api/specs` — list  
- `GET /api/specs/:id` — one  
- `POST /api/specs` — compose + save draft (`relay/compose`)  
- `POST /api/specs/:id/approve` — draft→frozen, frozen→running  
- `POST /api/specs/:id/abort` — aborted  

CommunityEngager may still persist Specs under its own `dataDir` when running with `--with-spec`; the shell store is the product governance surface (`RELAY_DATA_DIR`).
