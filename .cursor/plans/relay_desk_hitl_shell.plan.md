---
name: Relay Desk — HITL operator shell
overview: Add apps/relay-desk (Tauri) as a desktop operator shell — living-todo / intent later, Feedback Broker HITL now, embed computer-with-agent noVNC (vnc_url) when a human must watch or act. Keep computer-with-agent as the runtime sibling; no RFB client in v1.
todos:
  - id: p0-scaffold
    content: Scaffold apps/relay-desk (Tauri + web UI) in relay-os monorepo; package name @relay/apps-relay-desk; document run in apps/relay-desk/README.md
    status: completed
  - id: p1-gateway-client
    content: Settings for COMPUTER_GATEWAY_URL + COMPUTER_API_TOKEN; lease/acquire/heartbeat/release against computer-with-agent; open WebView on lease.vnc_url (autoconnect+resize=scale)
    status: pending
  - id: p1-seat-ui
    content: Minimal UI — connect to gateway, show free/leased/parked, open seat window, heartbeat while focused, soft-release on close
    status: pending
  - id: p2-feedback-adapter
    content: Desktop Feedback Broker adapter (approval / edit / abort / confirmation) parallel to Telegram/CLI; include vnc_url + job_id + session_id in WAITING_USER payloads from computer/interstitial paths
    status: pending
  - id: p2-ce-wire
    content: CommunityEngager computer dry-run + interstitial HITL surface cards in relay-desk; dogfood Approve while watching desk stream
    status: pending
  - id: p3-intent-stub
    content: Thin intent entry (text → kick engage / open seat) without owning Spec compile; defer full living-todo to relay_living_todo_shell
    status: pending
  - id: p4-thinkpad
    content: Document laptop install + env pointing at desk.hsv / 127.0.0.1 gateway; cross-link computer-with-agent AGENTS.md deploy
    status: pending
  - id: out-of-scope-v1
    content: "Explicit non-goals v1: native RFB client, LLM inside the desk app, on-demand K8s sandboxes, merging computer-with-agent into relay-os"
    status: pending
isProject: true
---

# Relay Desk — HITL operator shell (Tauri)

Canonical plan for a **desktop operator surface** that pairs Relay HITL with **computer-with-agent** streams. Sibling of [`relay_living_todo_shell.plan.md`](./relay_living_todo_shell.plan.md), [`relay_hitl_community_voltmem.plan.md`](./relay_hitl_community_voltmem.plan.md), and the computer runtime at `~/Projects/computer-with-agent` ([`AGENTS.md`](file:///Users/richardemate/Projects/computer-with-agent/AGENTS.md) / Computer Runtime API plan).

## Thesis fit

Relay: intent → frozen Spec → run → prove acceptance → **negotiate before irreversible action**.

Today negotiation is Telegram/CLI. **Relay Desk** is the same protocol in a native window, with an embedded remote desktop when the engine is `computer` (or interstitial HITL needs eyes on the GUI).

```text
User (Desk app)
    → Feedback Broker adapter (desktop)
    → CommunityEngager / AgentRuntime
    → engines-computer → computer-with-agent gateway
    → WAITING_USER + { vnc_url, session_id, job_id }
    → Desk: card + WebView(noVNC)
    → Approve / abort → runtime continues
```

## Repo boundary (locked)

| Repo / path | Owns |
|-------------|------|
| `~/Projects/computer-with-agent` | Workers, gateway, noVNC, Compose, `desk.hsv` deploy |
| **`relay-os/apps/relay-desk`** (this plan) | Tauri shell, HITL UI, embed `vnc_url`, later intent stub |
| `relay-os/packages/*` | protocol, feedback-broker, engines-computer (already) |

**Do not** put the Tauri app inside `computer-with-agent`. **Do not** merge the computer runtime into relay-os for v1.

## Why Tauri + noVNC (not native RFB)

- Ship HITL + stream without rebuilding VNC
- Lease already returns `vnc_url` with `autoconnect=1&resize=scale`
- RFB / TigerVNC-quality client is a later polish phase if WebView latency hurts

## Product shape (v1)

One composition: **operator console**, not a dashboard of ten widgets.

**First viewport (dogfood):**

- Connection status (gateway reachable / token set)
- Active or pending HITL card (Approve / Edit / Abort) when wired
- Primary CTA: **Open seat** / auto-open stream when feedback includes `vnc_url`
- Embedded noVNC for the leased session

Defer living-todo full queue UI to the living-todo plan; Desk may show a single “current job” strip only.

## Phases

### Phase 0 — Scaffold

- `apps/relay-desk` with Tauri 2 + small web frontend (Preact or whatever `relay-shell` uses — prefer consistency with `apps/relay-shell`)
- `pnpm` workspace package `@relay/apps-relay-desk`
- README: `pnpm --filter @relay/apps-relay-desk tauri dev`

### Phase 1 — Computer gateway client only

No Relay runtime required yet.

- Settings: gateway base URL (`http://desk.hsv` or `http://127.0.0.1:9000`), Bearer token
- API: lease, heartbeat, acquire (parked), soft-release, recycle
- UI: list/open seat → WebView loads `vnc_url`
- Heartbeat while the seat window is focused; soft-release on close

**Success:** From the app alone, lease a ThinkPad worker and watch Firefox via embedded noVNC.

### Phase 2 — Feedback Broker desktop adapter

- Implement adapter parallel to Telegram/CLI for feedback types used by CommunityEngager (`approval`, edit path, `abort`, `confirmation`, `credential` as needed)
- Ensure computer dry-run / interstitial paths attach `vnc_url` (+ `session_id`, `job_id`) on `WAITING_USER`
- Desk shows the card and opens/focuses the stream automatically when `vnc_url` present

**Success:** Engage → Approve in Desk while watching `desk1`/`desk2` stream; no Telegram required for that path.

### Phase 3 — Intent stub (thin)

- Text field: “engage” / “open computer seat” that shells out to existing host entrypoints or HTTP hooks — **does not** reimplement Spec compile
- Full living-todo queue remains [`relay_living_todo_shell.plan.md`](./relay_living_todo_shell.plan.md)

### Phase 4 — ThinkPad / laptop docs

- Install Desk on the Mac; point at `desk.hsv`
- Cross-link computer-with-agent deploy (Caddy `desk` / `desk1` / `desk2`)
- CE env: `COMPUTER_GATEWAY_URL`, matching token, `REDDIT_TRANSPORT=computer` dogfood

## Non-goals (v1)

- Native RFB client or replacing noVNC
- LLM / vision loop inside Desk
- On-demand K8s/Docker provisioner in Desk
- Replacing `apps/relay-shell` web Spec UI wholesale
- Merging `computer-with-agent` into this monorepo

## Dependencies

- computer-with-agent gateway healthy (local Compose or ThinkPad `desk.hsv`)
- `@relay/engines-computer` + CommunityEngager computer dry-run (already landed)
- Feedback Broker patterns from HITL plan

## Naming

- App / window: **Relay Desk**
- Package: `@relay/apps-relay-desk`
- Hostnames (runtime, not this app): `desk.hsv`, `desk1.hsv`, `desk2.hsv`
