# Relay shell

Preact product UI for **Spec governance** (list / review / New from Intent). Living-todo mounts later under `#/todo` — queue work stays in [`.cursor/plans/relay_living_todo_shell.plan.md`](../../.cursor/plans/relay_living_todo_shell.plan.md).

Not CommunityEngager-bound. Domain packs stay in their apps; “New from Intent” uses generic `relay/compose`.

## Dev (recommended)

```bash
pnpm --filter @relay/protocol build
pnpm --filter @relay/spec-store build
pnpm --filter @relay/apps-relay-shell dev:all
```

Opens Vite at http://127.0.0.1:5173 and Spec API at http://127.0.0.1:8790. Browser calls `/api/*`; Vite proxies to the API.

Or two terminals:

```bash
pnpm --filter @relay/apps-relay-shell api
pnpm --filter @relay/apps-relay-shell dev
```

## Production-ish (one process)

```bash
pnpm --filter @relay/apps-relay-shell build
RELAY_SHELL_SERVE_UI=1 pnpm --filter @relay/apps-relay-shell api
```

Serves `dist/` and `/api` from the same host/port (`SPEC_UI_PORT`, default `8790`).

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| `SPEC_UI_HOST` / `SPEC_UI_PORT` | `127.0.0.1` / `8790` | API listen |
| `SPEC_UI_PROXY_TARGET` | derived from host/port | Vite `/api` proxy target |
| `RELAY_DATA_DIR` | `.data` (cwd) | Spec store root |
| `RELAY_SHELL_SERVE_UI` | off | Serve `dist/` from API |
| `RELAY_SHELL_DIST` | `apps/relay-shell/dist` | Override static root |

Full API notes: [`docs/spec-ui.md`](../../docs/spec-ui.md).
