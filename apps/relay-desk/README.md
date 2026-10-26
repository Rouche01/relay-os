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

## Phase 1 / 1.5 — gateway seat + Watch

In the app:

1. Set **COMPUTER_GATEWAY_URL** + **COMPUTER_API_TOKEN** (defaults `http://127.0.0.1:9000` / `dev-token`)
2. **Probe** — gateway reachable
3. **Watch** — paste a worker `vnc_url` (or **Watch last park**) → stream only, no lease/heartbeat
4. **Open seat** — `POST /v1/sessions` with `job_id`, opens a WebView on `vnc_url` (`autoconnect=1&resize=scale`)
5. Heartbeat every 45s while **leased** and the desk window is visible (never while watching)
6. **Park** — soft `DELETE` (Firefox warm); **Acquire** — take exclusive claim (from parked or watching); **Recycle** — wipe + free worker
7. Closing the seat WebView soft-parks when still leased; closing a Watch window does not touch the gateway

Settings + last park target persist in `localStorage`. Gateway seat-list discovery is deferred (see plan Phase 1.5).

## Layout

| Path | Role |
|------|------|
| `src/gateway/` | Settings + HTTP client (lease / park / acquire / recycle / heartbeat) + last-park |
| `src/seat/` | Seat / Watch WebView helpers |
| `src-tauri/` | Tauri 2 + `gateway_http` command (no CORS) |
| Plan | [`.cursor/plans/relay_desk_hitl_shell.plan.md`](../../.cursor/plans/relay_desk_hitl_shell.plan.md) |

## Phases

0. Scaffold  
1. Gateway client + seat  
1.5. Watch (stream-only)  
1.6. Flowstep design — [Relay Desk](https://app.flowstep.ai/file?activeFileId=a7a26c2d-f42b-4309-955c-7f931d81c6fe)  
2. Feedback Broker desktop adapter + CommunityEngager wire  
3. Thin intent stub  
4. ThinkPad / laptop docs  
5. **Implement Flowstep UI** (replace scaffold look) — deferred  

Runtime stays in `computer-with-agent`; this app embeds `vnc_url` (no native RFB in v1). Current app chrome is a functional scaffold until Phase 5.