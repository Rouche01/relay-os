# Relay Desk

Desktop **HITL operator shell** (Tauri 2 + Preact). Pairs CommunityEngager feedback with an embedded [computer-with-agent](file:///Users/richardemate/Projects/computer-with-agent) noVNC seat (`vnc_url`).

Package: `@relay/apps-relay-desk`

## Prerequisites

- Node 22+ / pnpm 9+ (monorepo root)
- [Rust](https://rustup.rs/) stable (`rustup default stable`)
- macOS: Xcode CLT / Xcode
- computer-with-agent gateway for seats (`http://127.0.0.1:9000` or `http://desk.hsv`)

## Run

From the **monorepo root**:

```bash
pnpm install
pnpm --filter @relay/apps-relay-desk tauri:dev
```

- Frontend only: `pnpm --filter @relay/apps-relay-desk dev` → [http://localhost:1420](http://localhost:1420)  
  (Vite-only uses `fetch`; gateway must allow CORS, or use `tauri:dev` which calls via Rust.)
- Typecheck: `pnpm --filter @relay/apps-relay-desk typecheck`

## Phase 1 — gateway seat

In the app:

1. Set **COMPUTER_GATEWAY_URL** + **COMPUTER_API_TOKEN** (defaults `http://127.0.0.1:9000` / `dev-token`)
2. **Probe** — gateway reachable
3. **Open seat** — `POST /v1/sessions` with `job_id`, opens a WebView on `vnc_url` (`autoconnect=1&resize=scale`)
4. Heartbeat every 45s while leased and the desk window is visible
5. **Park** — soft `DELETE` (Firefox warm); **Acquire** — reattach; **Recycle** — wipe + free worker
6. Closing the seat WebView soft-parks when still leased

Settings persist in `localStorage`.

## Layout

| Path | Role |
|------|------|
| `src/gateway/` | Settings + HTTP client (lease / park / acquire / recycle / heartbeat) |
| `src/seat/` | Seat WebView helpers |
| `src-tauri/` | Tauri 2 + `gateway_http` command (no CORS) |
| Plan | [`.cursor/plans/relay_desk_hitl_shell.plan.md`](../../.cursor/plans/relay_desk_hitl_shell.plan.md) |

## Phases

0. Scaffold  
1. **Gateway client + seat** (current)  
2. Feedback Broker desktop adapter + CommunityEngager wire  
3. Thin intent stub  
4. ThinkPad / laptop docs  

Runtime stays in `computer-with-agent`; this app embeds `vnc_url` (no native RFB in v1).
