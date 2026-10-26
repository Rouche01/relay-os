# Relay Desk

Desktop **HITL operator shell** (Tauri 2 + Preact). Pairs CommunityEngager feedback with an embedded [computer-with-agent](https://github.com/) noVNC seat (`vnc_url`).

Package: `@relay/apps-relay-desk`

## Prerequisites

- Node 22+ / pnpm 9+ (monorepo root)
- [Rust](https://rustup.rs/) stable (`rustup default stable`)
- macOS: Xcode CLT (`xcode-select --install`)
- computer-with-agent gateway for Phase 1+ (local `http://127.0.0.1:9000` or `http://desk.hsv`)

## Run

From the **monorepo root**:

```bash
pnpm install
pnpm --filter @relay/apps-relay-desk tauri:dev
```

Or from this directory:

```bash
pnpm install
pnpm tauri:dev
```

- Frontend only (no native window): `pnpm --filter @relay/apps-relay-desk dev` → [http://localhost:1420](http://localhost:1420)
- Typecheck: `pnpm --filter @relay/apps-relay-desk typecheck`
- Release build: `pnpm --filter @relay/apps-relay-desk tauri:build`

## Layout

| Path | Role |
|------|------|
| `src/` | Preact UI (HITL card + seat later) |
| `src-tauri/` | Tauri 2 shell |
| Plan | [`.cursor/plans/relay_desk_hitl_shell.plan.md`](../../.cursor/plans/relay_desk_hitl_shell.plan.md) |

## Phases

0. **Scaffold** (this) — app boots, placeholder UI  
1. Gateway client — lease / heartbeat / soft-release, WebView on `vnc_url`  
2. Feedback Broker desktop adapter + CommunityEngager wire  
3. Thin intent stub  
4. ThinkPad / laptop docs  

Runtime stays in `computer-with-agent`; this app only embeds `vnc_url` (no native RFB in v1).
