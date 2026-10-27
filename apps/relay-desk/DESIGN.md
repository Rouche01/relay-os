# Relay Desk — concerns & design system

Canonical product/UI structure for `apps/relay-desk`. Visual source of truth in Flowstep: [Relay Desk](https://app.flowstep.ai/file?activeFileId=a7a26c2d-f42b-4309-955c-7f931d81c6fe). Implementation follows in plan **Phase 5**.

## Window model (locked)

| Window | Owns |
|--------|------|
| **Main — Relay Desk** | Brand, concern tiles, HITL runtime card, Settings drawer |
| **Stream WebView** | noVNC only — title `Relay Desk · Watch` (no claim) or `Relay Desk · Seat` (leased) |

Do **not** embed the live desktop as the main-window hero. Streams open in separate Tauri WebViews (`openSeatWindow`).

## Separation of concerns

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

1. **Header** — Relay Desk brand · **Settings** (quiet gear / label) · global status (idle / watching / claimed / HITL waiting).
2. **Primary row** — HITL (large when pending; quiet empty otherwise) + **Seat** inventory.
3. **Secondary row** — **Gateway** | **Watch** (bento tiles, unequal weight OK).

**Settings placement (locked):** header chrome only — typically immediately left of the status cluster. Do **not** leave Settings as a footer orphan under the Gateway/Watch row (breaks the bento grid). Opening it reveals a drawer with Gateway + HITL bridge fields.

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

- **Display / brand:** distinctive geometric or slab (e.g. Space Grotesk / similar) — “Relay Desk” is hero-level.
- **UI:** clean grotesque for labels and mono for ids/URLs (`ui-monospace`).
- Scale: brand ≫ section title ≫ body ≫ meta.

### Shape & depth

- Tiles: slight radius (`~0.5–0.75rem`), 1px signal-tint border, no heavy multi-shadow.
- Expand control on tiles (→ focused concern) optional.
- Atmosphere: subtle radial void gradient / fine grid; not illustrative collage.

### Motion (when implemented)

- Status pulse on live claim / HITL waiting (slow, low amplitude).
- Focus stream → bring WebView forward.
- Tile expand: short ease, not bounce.

### Components

- **Tile** — title, one short line, primary actions, optional expand.
- **Seat row** — mode badge (`Watch` | `Claimed`), id, Focus / Close.
- **HITL card** — kicker, prompt, Approve (signal) / Abort (ghost|danger).
- **Settings fields** — labeled inputs; Probe + result line.
- **Stream window chrome** — OS title only; no duplicated Desk chrome inside noVNC.

## Flowstep screens (target)

1. **Idle — console** — brand + Gateway / Watch / Seat (empty) / quiet HITL slot + Settings affordance  
2. **HITL pending** — large HITL tile + Seat row(s) + offset Watch window  
3. **Watching** — Watch tile active + Seat inventory + Watch window  
4. **Leased** — Gateway claim active + Seat inventory + Seat window  
5. **Settings** — Gateway + HITL bridge fields only  
6. **Multi-seat (future)** — Seat list with 2+ rows; still separate OS windows  

## Related

- Plan: [`.cursor/plans/relay_desk_hitl_shell.plan.md`](../../.cursor/plans/relay_desk_hitl_shell.plan.md)  
- Adapter: `@relay/adapters-desk` (`FEEDBACK_ADAPTER=desk`)  
