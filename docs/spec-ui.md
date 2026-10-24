# Spec governance (Relay shell)

App-agnostic Intent → Spec **Approve / Abort**. Not owned by CommunityEngager.

| Piece | Location |
|-------|----------|
| Spec store | [`@relay/spec-store`](../packages/spec-store) — `{RELAY_DATA_DIR\|\|.data}/specs.json` |
| API | [`apps/relay-shell/server/api.ts`](../apps/relay-shell/server/api.ts) |
| UI | [`apps/relay-shell`](../apps/relay-shell) — Specs list, Spec review, New from Intent; `#/todo` stub |
| Design | [Flowstep · Relay Spec](https://app.flowstep.ai/file?activeFileId=c2f134d4-1f9d-4c8c-975d-4b6baef2eeb4) |

Domain packs (e.g. `community-engager/engage`) stay in their apps. The shell’s “New from Intent” uses the generic `relay/compose` pack (primitives only).

Living-todo **queue / in-card HITL** is owned by [`.cursor/plans/relay_living_todo_shell.plan.md`](../.cursor/plans/relay_living_todo_shell.plan.md); the shell only mounts a `#/todo` stub for now.

## Run (dev)

```bash
pnpm --filter @relay/protocol build
pnpm --filter @relay/spec-store build

# One command — API :8790 + Vite :5173 (proxies /api → API)
pnpm --filter @relay/apps-relay-shell dev:all
```

Or split:

```bash
pnpm --filter @relay/apps-relay-shell api
pnpm --filter @relay/apps-relay-shell dev
```

- UI: http://127.0.0.1:5173  
- API: http://127.0.0.1:8790  

Vite proxies `/api` → `SPEC_UI_PROXY_TARGET` (default `http://127.0.0.1:8790`). Same proxy applies to `vite preview`.

## Run (built UI + API)

```bash
pnpm --filter @relay/apps-relay-shell build
pnpm --filter @relay/apps-relay-shell start   # RELAY_SHELL_SERVE_UI=1
```

One process serves `/api` and `dist/` on `SPEC_UI_PORT`.

| Env | Default |
|-----|---------|
| `SPEC_UI_HOST` / `SPEC_UI_PORT` | `127.0.0.1` / `8790` |
| `SPEC_UI_PROXY_TARGET` | `http://$HOST:$PORT` |
| `RELAY_DATA_DIR` | `.data` (cwd) |
| `RELAY_SHELL_SERVE_UI` | off (`start` sets on) |
| `RELAY_SHELL_DIST` | `apps/relay-shell/dist` |

App README: [`apps/relay-shell/README.md`](../apps/relay-shell/README.md).

## API

- `GET /api/health` — ok + store path (+ `ui` when serving dist)
- `GET /api/specs` — list  
- `GET /api/specs/:id` — one  
- `POST /api/specs` — compose + save draft (`relay/compose`)  
- `POST /api/specs/:id/approve` — draft→frozen, frozen→running  
- `POST /api/specs/:id/abort` — aborted  

CommunityEngager may still persist Specs under its own `dataDir` when running with `--with-spec`; the shell store is the product governance surface (`RELAY_DATA_DIR`).
