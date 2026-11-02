# Relay Desk

Desktop **HITL operator shell** (Tauri 2 + Preact). Pairs CommunityEngager feedback with an embedded [computer-with-agent](file:///Users/richardemate/Projects/computer-with-agent) noVNC seat (`vnc_url`).

**How it works (plain language):** [`GUIDE.md`](./GUIDE.md) — Seats · Build · Apps, ship checklist, glossary.

Package: `@relay/apps-relay-desk`

## Prerequisites

- Node 22+ / pnpm 9+ (monorepo root)
- [Rust](https://rustup.rs/) stable (`rustup default stable`)
- macOS: Xcode CLT / Xcode
- computer-with-agent gateway for seats (local or remote — see below)

## Gateway profiles (local or remote)

Desk talks to **any** computer-with-agent gateway over HTTP. Same app, two common setups:

| Profile | `COMPUTER_GATEWAY_URL` | When |
|---------|------------------------|------|
| **Local** | `http://127.0.0.1:9000` (default) | Compose on this machine; dogfood / same-box seats |
| **Remote** | e.g. `https://cu-gateway.hsv` | ThinkPad (or other host) running the runtime; Desk is client-only |

Use **`https://`** for Caddy-fronted hosts (plain `http://` may 308 in a way clients mishandle). Token must match the gateway. Stream `vnc_url`s come from the gateway (`cu1.hsv` / `cu2.hsv` when remote). Tauri HTTP uses the **system trust store** so Caddy’s Local Authority (installed on the Mac) is accepted.

Guided local install / Docker-free path: [`.cursor/plans/relay_desk_local_runtime.plan.md`](../../.cursor/plans/relay_desk_local_runtime.plan.md) (deferred).

**Laptop ↔ ThinkPad runbook:** [`LAPTOP.md`](./LAPTOP.md) (install Desk, `/etc/hosts`, Caddy CA, Settings, CE dogfood).

**Download (GitHub Releases):** tag `relay-desk-v*` or run workflow **Relay Desk release** — draft release with macOS DMGs (see `LAPTOP.md` § GitHub Release).

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
7. **Refresh seats** — `GET /v1/seats` pool inventory; Watch / Acquire / Recycle per parked or leased worker when Open seat returns `no free workers`
8. Closing the seat WebView soft-parks when still leased; closing a Watch window does not touch the gateway

Settings + last park target persist in `localStorage`.

## Phase 2 — Desk HITL bridge

CommunityEngager presents feedback over HTTP when `FEEDBACK_ADAPTER=desk` (package `@relay/adapters-desk`).

```bash
# CE host
FEEDBACK_ADAPTER=desk DESK_HITL_PORT=9100 pnpm --filter @relay/apps-community-engager start
# or: --adapter=desk
```

In Desk: set **DESK_HITL_URL** (`http://127.0.0.1:9100`) + optional token → **Probe HITL**. Pending cards poll every 2s; Approve/Abort; auto-Watch when `meta.vncUrl` (or VNC `context.url`) is present.

## Spec surface (v2)

Sidebar **Spec** owns Intent → scaffold → validate → evals → freeze → dry-run. HITL cards stay on Console.

```bash
# Spec host (default http://127.0.0.1:8790)
pnpm --filter @relay/apps-relay-shell api
```

In Desk Settings: **DESK_SPEC_API_URL** → **Probe Spec**. Scaffold uses the shell LLM when `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` is set in `apps/relay-shell/.env`; otherwise (or with `RELAY_SPEC_SCAFFOLD_STUB=1`) it falls back to an offline stub.

## Layout

| Path | Role |
|------|------|
| `src/gateway/` | Settings + HTTP client (lease / park / acquire / recycle / heartbeat) + last-park |
| `src/spec/` | Spec v2 surface + shell API client |
| `src/seat/` | Seat / Watch WebView helpers |
| `src-tauri/` | Tauri 2 + `gateway_http` command (no CORS) |
| Plan | [`.cursor/plans/relay_desk_hitl_shell.plan.md`](../../.cursor/plans/relay_desk_hitl_shell.plan.md) |
| Laptop install | [`LAPTOP.md`](./LAPTOP.md) |
| Local runtime (optional) | [`.cursor/plans/relay_desk_local_runtime.plan.md`](../../.cursor/plans/relay_desk_local_runtime.plan.md) |
| Design | [`DESIGN.md`](./DESIGN.md) · [Flowstep](https://app.flowstep.ai/file?activeFileId=a7a26c2d-f42b-4309-955c-7f931d81c6fe) |

Runtime stays in `computer-with-agent`; streams open in a **separate** WebView (no native RFB in v1). Sidebar: **Console** (operator bento) · **Spec** (scaffold).