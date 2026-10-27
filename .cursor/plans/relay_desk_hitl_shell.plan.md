---
name: Relay Desk — HITL operator shell
overview: Add apps/relay-desk (Tauri) as a desktop operator shell — living-todo / intent later, Feedback Broker HITL now, embed computer-with-agent noVNC (vnc_url) when a human must watch or act. Watch (stream only) is separate from Acquire (exclusive lease). Keep computer-with-agent as the runtime sibling; no RFB client in v1.
todos:
  - id: p0-scaffold
    content: Scaffold apps/relay-desk (Tauri + web UI) in relay-os monorepo; package name @relay/apps-relay-desk; document run in apps/relay-desk/README.md
    status: completed
  - id: p1-gateway-client
    content: Settings for COMPUTER_GATEWAY_URL + COMPUTER_API_TOKEN; lease/acquire/heartbeat/release against computer-with-agent; open WebView on lease.vnc_url (autoconnect+resize=scale)
    status: completed
  - id: p1-seat-ui
    content: Minimal UI — connect to gateway, show free/leased/parked, open seat window, heartbeat while focused, soft-release on close
    status: completed
  - id: p1.5-watch
    content: "Watch path (no exclusive lease): open stream from known vnc_url / session_id / last park; optional gateway seat list (free/leased/parked + vnc_url); UI separates Watch vs Acquire"
    status: completed
  - id: p1.6-flowstep-design
    content: "Flowstep design for Relay Desk operator shell — first pass (Idle / Watching+HITL / Leased); scaffold UI remains until p5"
    status: completed
  - id: p1.7-flowstep-sync
    content: "Flowstep sync to current Desk: Idle (+ Watch last park), Settings, Parked, Watching (no HITL); Watching+HITL kept as Phase 2 variant; separate stream window locked"
    status: completed
  - id: p1.8-concerns-ds
    content: "Document concern split (Gateway/Watch/Seat/HITL/Settings) + multi-seat extension in apps/relay-desk/DESIGN.md; futuristic design system; Flowstep screens match bento console"
    status: completed
  - id: p2-feedback-adapter
    content: Desktop Feedback Broker adapter (approval / edit / abort / confirmation) parallel to Telegram/CLI; include vnc_url + job_id + session_id in WAITING_USER payloads from computer/interstitial paths
    status: completed
  - id: p2-ce-wire
    content: CommunityEngager computer dry-run + interstitial HITL surface cards in relay-desk; dogfood Approve while watching desk stream
    status: completed
  - id: p5-flowstep-ui
    content: "Implement DESIGN.md + Flowstep Relay Desk UI: Gateway/Watch/Seat/HITL tiles, Settings drawer; stream stays separate WebView; Seat inventory ready for multi-seat later"
    status: completed
  - id: p3-intent-stub
    content: Thin intent entry (text → kick engage / open seat) without owning Spec compile; defer full living-todo to relay_living_todo_shell
    status: pending
  - id: p4-thinkpad
    content: Document laptop install + env pointing at desk.hsv / 127.0.0.1 gateway; cross-link computer-with-agent AGENTS.md deploy
    status: pending
  - id: p1.5-gateway-list
    content: "computer-with-agent GET /v1/seats + Desk Gateway pool rows (Watch/Acquire/Recycle)"
    status: completed
    status: pending
  - id: out-of-scope-v1
    content: "Explicit non-goals v1: native RFB client, LLM inside the desk app, on-demand K8s sandboxes, merging computer-with-agent into relay-os, in-main VNC mosaic (multi separate OS windows OK later via Seat inventory)"
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

**Operator console** with clear concern tiles (bento hierarchy), not a marketing mosaic and not a form dump.

Canonical write-up: [`apps/relay-desk/DESIGN.md`](../../apps/relay-desk/DESIGN.md).

**Concerns**

| Concern | Role |
|---------|------|
| **Gateway** | Claim path — Probe, Open seat / Park / Acquire / Recycle |
| **Watch** | Observe path — paste / last park → Watch window (no claim) |
| **Seat** | Inventory of **active stream windows** (from Gateway or Watch); Focus / close |
| **HITL** | Runtime Approve/Abort card (setup for the bridge lives in **Settings**) |
| **Settings** | Gateway + HITL bridge URLs/tokens, job_id, probes |

**Window model:** main Desk = chrome + tiles; noVNC = separate WebView (`Watch` / `Seat`). No embedded stream hero.

**Multi-seat:** v1 ships **one** stream window; Seat UI is a **list** so multiple separate OS windows can be added later without redesigning concerns (still no in-main VNC mosaic).

Defer living-todo full queue UI to the living-todo plan.

### Watch vs Acquire

| Mode | Gateway claim | Use |
|------|---------------|-----|
| **Watch** | None (open `vnc_url` only) | HITL eyes-on, ops “what’s on desk2?”, debug parked jobs without stealing the lease |
| **Acquire / Open seat** | Exclusive lease + heartbeat | Human drives mouse/keyboard; agent must not hold the same seat |

Watch must not call lease/acquire or proxy actions. Promote Watch → Acquire only via an explicit CTA when the operator needs control.

## Phases

### Phase 0 — Scaffold

- `apps/relay-desk` with Tauri 2 + small web frontend (Preact or whatever `relay-shell` uses — prefer consistency with `apps/relay-shell`)
- `pnpm` workspace package `@relay/apps-relay-desk`
- README: `pnpm --filter @relay/apps-relay-desk tauri:dev`

### Phase 1 — Computer gateway client only

No Relay runtime required yet.

- Settings: gateway base URL (`http://desk.hsv` or `http://127.0.0.1:9000`), Bearer token
- API: lease, heartbeat, acquire (parked), soft-release, recycle
- UI: open seat → WebView loads `vnc_url`
- Heartbeat while the seat window is focused; soft-release on close

**Success:** From the app alone, lease a ThinkPad worker and watch Firefox via embedded noVNC.

### Phase 1.5 — Watch existing worker (no exclusive lease)

Lease-only is too blunt for HITL and multi-worker ops. Add a **Watch** path beside **Open seat**.

**Desk (minimal first):**

- **Watch from known target:** paste `vnc_url`, or reopen last parked `session_id` / stored `vnc_url` without calling lease
- UI: clear **Watch** vs **Acquire**; Watch window has no action proxy / no heartbeat claim
- Optional: **Promote to Acquire** when the operator needs control (then heartbeat + soft-release rules apply)

**Gateway (when discovery is needed):**

- Today `/health` exposes aggregate `free` / `leased` / `parked` only — not per-worker `vnc_url`
- Add a small **seat list** (or enrich health) returning workers/sessions: id, state (`free` \| `leased` \| `parked`), `vnc_url`, optional `job_id` / `session_id`
- Lives in `computer-with-agent`; Desk consumes it — still no multi-tile dashboard in v1 (picker → one stream)

**Success:** Operator picks desk1/desk2 (or pastes `vnc_url`) and streams without taking a lease; can Acquire later if they need to drive.

### Phase 1.6–1.8 — Flowstep + DESIGN.md (code in Phase 5)

- **Repo:** [`apps/relay-desk/DESIGN.md`](../../apps/relay-desk/DESIGN.md) — concerns, multi-seat extension, futuristic design tokens
- **Flowstep:** [Relay Desk](https://app.flowstep.ai/file?activeFileId=a7a26c2d-f42b-4309-955c-7f931d81c6fe) — DESIGN.md mirrored; bento console screens (Gateway / Watch / Seat / HITL / Settings)
- Stream remains a **separate** WebView; Seat tile is an inventory list (v1: one row; later: multi)

Scaffold UI stays until **Phase 5**.

**Todo order:** p2 (done) → p2-ce-wire → p5 → p3 → p4; optional `p1.5-gateway-list` last.

### Phase 2 — Feedback Broker desktop adapter

- **Done:** `@relay/adapters-desk` HTTP bridge (`FEEDBACK_ADAPTER=desk` / `--adapter=desk`); `GET /v1/pending`, `POST /v1/respond`; `cancelPresent` for auto-clear
- Host wiring: `run-dev` / `run-ops` / `run-scheduler`; env `DESK_HITL_HOST` / `PORT` / `TOKEN`
- Desk: HITL URL settings, poll, Approve/Abort card, auto-Watch on `meta.vncUrl` (camelCase — already on computer challenge WAITING_USER)
- **Follow-on (p2-ce-wire):** dogfood CE computer dry-run / interstitial end-to-end in Desk

**Success (adapter):** CE with desk adapter + Desk Probe HITL / Approve path works without Telegram.

### Phase 3 — Intent stub (thin)

- Text field: “engage” / “open computer seat” that shells out to existing host entrypoints or HTTP hooks — **does not** reimplement Spec compile
- Full living-todo queue remains [`relay_living_todo_shell.plan.md`](./relay_living_todo_shell.plan.md)

### Phase 4 — ThinkPad / laptop docs

- Install Desk on the Mac; point at `desk.hsv`
- Cross-link computer-with-agent deploy (Caddy `desk` / `desk1` / `desk2`)
- CE env: `COMPUTER_GATEWAY_URL`, matching token, `REDDIT_TRANSPORT=computer` dogfood

### Phase 5 — Implement Flowstep UI (done)

Main window matches [`apps/relay-desk/DESIGN.md`](../../apps/relay-desk/DESIGN.md):

- Header: brand · Settings · status
- Bento: HITL | Seat / Gateway | Watch
- Settings drawer: gateway + HITL bridge fields
- Stream still separate WebView; Seat tile is a list (v1: one row)

**Success:** Desk looks like the Flowstep console; Watch / Open seat / Acquire / Park / HITL still work.

## Non-goals (v1)

- Native RFB client or replacing noVNC
- LLM / vision loop inside Desk
- On-demand K8s/Docker provisioner in Desk
- Replacing `apps/relay-shell` web Spec UI wholesale
- Merging `computer-with-agent` into this monorepo
- Multi-tile / mosaic VNC dashboard (one stream + seat picker only)

## Dependencies

- computer-with-agent gateway healthy (local Compose or ThinkPad `desk.hsv`)
- `@relay/engines-computer` + CommunityEngager computer dry-run (already landed)
- Feedback Broker patterns from HITL plan

## Naming

- App / window: **Relay Desk**
- Package: `@relay/apps-relay-desk`
- Hostnames (runtime, not this app): `desk.hsv`, `desk1.hsv`, `desk2.hsv`
