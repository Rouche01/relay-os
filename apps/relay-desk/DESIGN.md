# Relay Desk — concerns & design system

Canonical product/UI structure for `apps/relay-desk`. Visual source of truth in Flowstep: [Relay Desk](https://app.flowstep.ai/file?activeFileId=a7a26c2d-f42b-4309-955c-7f931d81c6fe).

## Window model (locked)

| Window | Owns |
|--------|------|
| **Main — Relay Desk** | Collapsible sidebar nav, status chrome, Settings drawer, active surface body |
| **Stream WebView** | noVNC only — title `Relay Desk · Watch` (no claim) or `Relay Desk · Seat` (leased) |

Do **not** embed the live desktop as the main-window hero. Streams open in separate Tauri WebViews (`openSeatWindow`).

## App navigation (locked) — collapsible sidebar

**Console vs Spec** are primary **surfaces**, not top tabs. Nav lives in a **left sidebar** that collapses to **icon-only**.

| Surface | Owns | Does not own |
|---------|------|----------------|
| **Console** | Gateway / Watch / Seat / HITL — current Idle bento (title + 7/5 grid) | Intent→Spec compile, living-todo queue |
| **Spec** | Intent → draft Spec → freeze → run (governance) | Seat lease chrome, live stream controls |

**Why sidebar (not top tabs):** Spec will grow; Console stays dense operator chrome; collapse keeps the bento wide when working seats/HITL. Top tabs were interim only.

**Sidebar (expanded ~12–14rem)**
- Top: brand mark + “Relay Desk” (serif)
- Nav: Console · Spec (icon + label; active = ink weight / quiet indicator)
- Footer: Settings (opens drawer) · collapse control
- Optional later: more Spec children under Spec — still sidebar, not a third top tab

**Sidebar (collapsed ~3.5rem)**
- Brand mark only · icon nav · Settings gear · expand control
- Tooltips on hover for labels

**Main column**
- Thin top strip: global status only (`desk.hsv · ready` / HITL waiting) — no duplicate Console|Spec
- Body: Console bento **unchanged**, or Spec scaffold

**Locked:** No Spec compiler strip on Console Idle. No primary nav in the top bar.

Spec implementation follows [`relay_intent_spec_verify_hitl.plan.md`](../../.cursor/plans/relay_intent_spec_verify_hitl.plan.md) / [`relay_living_todo_shell.plan.md`](../../.cursor/plans/relay_living_todo_shell.plan.md). Desk ships Spec as **scaffold** until that work lands.

```text
┌──────────┬─────────────────────────────┐
│ Sidebar  │ status                      │
│ Console  ├─────────────────────────────┤
│ Spec     │ Console bento  OR  Spec     │
│ …        │ (collapse → icons only)     │
│ Settings │                             │
└──────────┴─────────────────────────────┘
```

## Gateway topology (locked)

Desk is a **client** of computer-with-agent. The gateway may be:

| Profile | Typical URL | Notes |
|---------|-------------|--------|
| **Local** | `http://127.0.0.1:9000` | Compose (or future Docker-free engine) on the same machine as Desk |
| **Remote** | `https://cu-gateway.hsv` (or similar) | Runtime on ThinkPad / always-on host; Desk install is client-only; prefer HTTPS via Caddy |

Settings (`COMPUTER_GATEWAY_URL` + token) select the profile — no separate Desk builds. Optional guided local install: [`.cursor/plans/relay_desk_local_runtime.plan.md`](../../.cursor/plans/relay_desk_local_runtime.plan.md).

## Separation of concerns (Console)

| Concern | Role | Owns | Does not own |
|---------|------|------|----------------|
| **Gateway** | Claim path | Probe (gateway), Open seat / Park / Acquire / Recycle, lease + heartbeat status | Observe-only watch |
| **Watch** | Observe path | Paste/`last park`/picker → open Watch window, Focus (no claim) | Lease lifecycle |
| **Seat** | Active-stream inventory | List of open stream windows (from Gateway *or* Watch), Focus / close per row | Its own lease API |
| **HITL** | Runtime negotiation | Pending Approve / Abort / Edit card; auto-open Watch when `meta.vncUrl` | Long-lived setup fields |
| **Settings** | All setup | Gateway URL/token, HITL bridge URL/token, `job_id`, probes | Live Approve during a run |

**HITL Bridge setup lives in Settings** (not a permanent fifth hero tile). The **HITL** tile/card is runtime-only.

```text
Gateway ──Open seat / Acquire──► Seat window (claimed) ──► Seat inventory
Watch   ──Watch / last park────► Watch window (no claim) ──► Seat inventory
HITL pending ──meta.vncUrl─────► prefer Watch window + Approve in main
Settings ── configures Gateway + HITL bridge endpoints
```

### Watch vs Acquire (unchanged)

| Mode | Gateway claim | Use |
|------|---------------|-----|
| Watch | None | Eyes-on, debug, HITL without stealing the lease |
| Acquire / Open seat | Exclusive + heartbeat | Human drives; agent must not hold the same seat |

### Multi-seat (extension)

- **v1 ship:** at most **one** stream WebView (current behavior).
- **Seat panel** is designed as a **list** so multiple Watch/Seat windows can appear later without a layout rewrite.
- Revisit the plan non-goal “no multi-tile VNC mosaic” when enabling multi-seat: still **no mosaic of VNC inside main** — multiple **separate** OS windows + Seat inventory rows.

## Main-window composition

1. **Sidebar** — brand · Console · Spec · Settings · collapse (expanded or icon-only).
2. **Status strip** — global status only (idle / watching / claimed / HITL waiting).
3. **Console surface** — title + subtitle → HITL | Seat → Gateway | Watch (current layout; do not regress).
4. **Spec surface** — Intent → scaffold YAML → validator / rules / evals → lower → freeze → dry-run (shell `/api/v2/*`). HITL cards stay on Console.
5. **Settings** — from sidebar → drawer (Gateway + HITL bridge + Spec API URL).

Operator console first; bento for **hierarchy**, not marketing-grid density. No mini-VNC previews inside tiles.

## Design system (futuristic operator)

Theme: **deep-space operator** — graphite void, ice signal, amber hazard. Futuristic without purple SaaS glow spam.

### Color

| Token | Hex | Use |
|-------|-----|-----|
| `--void` | `#070A0F` | App background |
| `--panel` | `#0E141C` | Tile / panel surface |
| `--panel-2` | `#151D28` | Elevated tile |
| `--line` | `rgba(140, 200, 255, 0.12)` | Hairline borders |
| `--ink` | `#E8F1FA` | Primary text |
| `--muted` | `#7A8B9C` | Secondary text |
| `--signal` | `#3EE0C4` | Primary CTA / live / focus (ice cyan) |
| `--signal-dim` | `#1A6B5E` | Signal pressed / track |
| `--warn` | `#E0B35A` | Watching / warm park |
| `--danger` | `#E05A5A` | Recycle / Abort |
| `--hitl` | `#3EE0C4` @ 10% fill | HITL card wash |

Avoid: purple-indigo gradients, soft cream+terracotta, neon multi-glow stacks, Inter-as-brand.

### Typography

- **Display / brand:** Instrument Serif (or similar) — “Relay Desk” is hero-level.
- **UI:** Inter / grotesque for labels; mono for ids/URLs.
- Scale: brand ≫ section title ≫ body ≫ meta.

### Shape & depth

- Tiles: slight radius (`~0.5–0.75rem`), 1px signal-tint border, no heavy multi-shadow.
- Tab active: ink underline or weight; inactive muted — not pill spam.
- Atmosphere: subtle radial void gradient / fine grid; not illustrative collage.

### Motion (when implemented)

- Status pulse on live claim / HITL waiting (slow, low amplitude).
- Focus stream → bring WebView forward.
- Tab switch: instant or short fade; not bounce.

### Components

- **Sidebar nav** — Console | Spec (+ collapse); Settings in rail footer.
- **Tile** — title, one short line, primary actions, optional expand.
- **Seat row** — mode badge (`Watch` | `Claimed`), id, Focus / Close.
- **HITL card** — kicker, prompt, Approve (signal) / Abort (ghost|danger).
- **Settings fields** — labeled inputs; Probe + result line.
- **Spec surface** — Intent box, YAML editor, validator/evals/manifest tiles, Freeze + Run dry.
- **Stream window chrome** — OS title only; no duplicated Desk chrome inside noVNC.

## Flowstep screens (target)

1. **Idle — console** — sidebar expanded; Console active; current bento  
2. **Idle — console (collapsed)** — icon-only sidebar; same bento  
3. **Spec — surface** — sidebar; Spec active; Intent→YAML→evals→run  
4. **Spec — surface (collapsed)** — icon-only sidebar  
5. **HITL pending** / **Watching** / **Leased** / **Parked** / **Settings** — Console modes (unchanged concerns; adopt sidebar)  
6. **Multi-seat (future)** — Seat list with 2+ rows; still separate OS windows  
7. Top-tab / Idle intent-strip screens — superseded; archive or delete later  

## Related

- Plan: [`.cursor/plans/relay_desk_hitl_shell.plan.md`](../../.cursor/plans/relay_desk_hitl_shell.plan.md)  
- Laptop install: [`LAPTOP.md`](./LAPTOP.md)  
- Spec thesis: [`.cursor/plans/relay_intent_spec_verify_hitl.plan.md`](../../.cursor/plans/relay_intent_spec_verify_hitl.plan.md)  
- Adapter: `@relay/adapters-desk` (`FEEDBACK_ADAPTER=desk`)  
