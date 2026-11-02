# Relay Desk — concerns & design system

Canonical product/UI structure for `apps/relay-desk`. Visual source of truth in Flowstep: [Relay Desk](https://app.flowstep.ai/file?activeFileId=a7a26c2d-f42b-4309-955c-7f931d81c6fe).

## Window model (locked)

| Window | Owns |
|--------|------|
| **Main — Relay Desk** | Collapsible sidebar nav, status chrome, Settings drawer, active surface body |
| **Stream WebView** | noVNC only — title `Relay Desk · Watch` (no claim) or `Relay Desk · Seat` (leased) |

Do **not** embed the live desktop as the main-window hero. Streams open in separate Tauri WebViews (`openSeatWindow`).

## App navigation (locked) — collapsible sidebar

**Seats · Build · Apps** are primary **surfaces**, not top tabs. Nav lives in a **left sidebar** that collapses to **icon-only**. **My Desk** is a locked fourth name — reserved, not rendered until [`desk_my_desk.plan.md`](../../.cursor/plans/desk_my_desk.plan.md) (backlog, design-first).

| Surface | Owns | Does not own |
|---------|------|----------------|
| **Seats** | Gateway / Watch / Seat / HITL — current Idle bento (title + 7/5 grid). Pooled computers any app can spin; you attend them. | Intent→Spec compile, approved-fleet management, the user's personal computer |
| **Build** | Intent → Spec → Manifest → App. In-progress library, New spec, Design / Verify / Ship. | Seat lease chrome, live stream controls, approved fleet |
| **Apps** | Approved / installed apps as a managed fleet (enable, pause, connections, schedules, runs). | Drafts, scaffold, Design/Verify authoring |
| **My Desk** | *(reserved)* Dedicated personal virtual computer — persistent, never pooled. | Seats inventory, Build authoring |

**Why sidebar (not top tabs):** Build will grow; Seats stays dense operator chrome; collapse keeps the bento wide when working seats/HITL. Top tabs were interim only.

**Sidebar (expanded ~12–14rem)**
- Top: brand mark + “Relay Desk” (serif)
- Nav: Seats · Build · Apps (icon + label; active = ink weight / quiet indicator). My Desk not shown until its plan leaves backlog.
- Footer: Settings (opens drawer) · collapse control

**Sidebar (collapsed ~3.5rem)**
- Brand mark only · icon nav · Settings gear · expand control
- Tooltips on hover for labels

**Main column**
- Thin top strip: global status only (`desk.hsv · ready` / HITL waiting) — no duplicate rail labels
- Body: Seats bento **unchanged**, or Build / Apps surface

**Locked:** No Spec compiler strip on Seats Idle. No primary nav in the top bar. Do not implement My Desk as “another seat.”

Build / Apps workspace follows [`desk_spec_workspace_ux.plan.md`](../../.cursor/plans/desk_spec_workspace_ux.plan.md). Seats is today's Console (rename only).

```text
┌──────────┬─────────────────────────────┐
│ Sidebar  │ status                      │
│ Seats    ├─────────────────────────────┤
│ Build    │ Seats bento  OR  Build/Apps │
│ Apps     │ (collapse → icons only)     │
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

## Separation of concerns (Seats)

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

1. **Sidebar** — brand · Seats · Build · Apps · Settings · collapse (expanded or icon-only). My Desk reserved, not rendered.
2. **Status strip** — global status only (idle / watching / claimed / HITL waiting).
3. **Seats surface** — title + subtitle → HITL | Seat → Gateway | Watch (current Console layout; do not regress).
4. **Build surface** — Intent → Spec → Manifest → App (library / new / Design · Verify · Ship · Activity). HITL cards stay on Seats.
5. **Apps surface** — approved fleet (install, enable/pause, connect, runs). Edit spec / thaw returns to Build Design.
6. **Settings** — from sidebar → drawer (Gateway + HITL bridge + Spec API URL).

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

**Flowstep → CSS lock:** prototypes use Flowstep `grayscaleDark` (primary often renders light/gray). Desk `styles.css` is the source of truth — map every Flowstep “primary” accent to `--signal` (`#3EE0C4`), panels to `--panel` / `--panel-2`, text to `--ink` / `--muted`. Do not ship Flowstep grayscale hex into Desk components.

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

- **Sidebar nav** — Seats · Build · Apps (+ collapse); Settings in rail footer. My Desk reserved.
- **Tile** — title, one short line, primary actions, optional expand.
- **Seat row** — mode badge (`Watch` | `Claimed`), id, Focus / Close.
- **HITL card** — kicker, prompt, Approve (signal) / Abort (ghost|danger).
- **Settings fields** — labeled inputs; Probe + result line.
- **Build workspace** — library + New spec; Design (schematic / YAML) · Verify · Ship · Activity; draft store on this Desk.
- **Stream window chrome** — OS title only; no duplicated Desk chrome inside noVNC.

### Copy (Spec/App workspace)

- **One stage vocabulary:** `Design · Verify · Ship · Activity` in journey bar, stage nav, and CTAs. Lifecycle (`Draft | Frozen | Live`) only in the header pill; gate specifics (freeze, shadow, enable) live inside Ship, never as competing journey labels.
- **Name the user's thing, not the UI:** headings and rows use the app and its concrete actions (`Bug triage for acme/widgets`, “The only irreversible step is `post`…”, “No issue can be commented on twice”). Internal nouns (`scaffold`, `lower`, `thaw`, bundle ids, `specHash`) appear only in mono detail lines, never as primary labels — user-facing verbs are *Create draft*, *run checks*, *Edit spec*.
- **No UI-meta copy:** don't explain the interface (“status travels…”, “one question per view”), don't repeat the same label in subtitle + section title + nav, and don't show outcome/state chips before the action has happened. Every line must either name a state, a consequence, or a next action.

## Flowstep screens

1. **Idle — console** — ✅ implemented as **Seats**; sidebar expanded; current bento  
2. **Idle — console (collapsed)** — ✅ icon-only sidebar; same bento  
3. **Spec — surface** — ❌ superseded by (8)+(9); single scrolling Spec surface removed  
4. **Spec — surface (collapsed)** — ❌ superseded  
5. **HITL pending** / **Watching** / **Leased** / **Parked** / **Settings** — ✅ Seats modes (sidebar + Settings drawer)  
6. **Multi-seat (future)** — Seat list with 2+ rows; still separate OS windows  
7. Top-tab / Idle intent-strip screens — superseded; archive or delete later  
8. **Specs — library / Specs — new** — ✅ implemented (`#/build`, `#/build/new`). Build library = in-progress drafts only; New spec presets → Create draft → Design; Paste-YAML secondary; Install-bundle on Apps.  
9. **Workspace — Design / Verify / Ship / Activity** — ✅ implemented (`#/build/:draftId/:view`). Header + journey; Enable → Apps; Apps *Edit spec* → Build Design; Activity HITL → Seats.  
10. **My Desk** — *not prototyped.* Reserved rail item; see [`desk_my_desk.plan.md`](../../.cursor/plans/desk_my_desk.plan.md).

## Related

- Operator guide (plain language): [`GUIDE.md`](./GUIDE.md)  
- Workspace UX: [`.cursor/plans/desk_spec_workspace_ux.plan.md`](../../.cursor/plans/desk_spec_workspace_ux.plan.md)  
- My Desk (backlog): [`.cursor/plans/desk_my_desk.plan.md`](../../.cursor/plans/desk_my_desk.plan.md)  
- Plan: [`.cursor/plans/relay_desk_hitl_shell.plan.md`](../../.cursor/plans/relay_desk_hitl_shell.plan.md)  
- Laptop install: [`LAPTOP.md`](./LAPTOP.md)  
- Spec thesis: [`.cursor/plans/relay_intent_spec_verify_hitl.plan.md`](../../.cursor/plans/relay_intent_spec_verify_hitl.plan.md)  
- Adapter: `@relay/adapters-desk` (`FEEDBACK_ADAPTER=desk`)  
