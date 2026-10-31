---
name: Desk — My Desk
overview: "Backlog. The user's dedicated personal virtual computer — persistent, private, never pooled. Design in Flowstep before any implementation. Blocked on screens + the open questions below. Do not fold into desk_spec_workspace_ux or the Seats gateway work."
todos:
  - id: md0-product-lock
    content: Product lock (done 2026-10-31) — My Desk is the user's own computer; opposite lifecycle of a Seat (no lease, heartbeat, park, or recycle); agent acts only by invitation from inside it; rail name locked
    status: completed
  - id: md1-flowstep-rail
    content: Flowstep — add My Desk as the fourth rail item on existing Relay Desk screens so Seats · Build · Apps · My Desk read as one shell (no implementation)
    status: pending
  - id: md2-flowstep-idle
    content: Flowstep — My Desk idle/home (what is on this computer, how you start work, how it is obviously not a Seat)
    status: pending
  - id: md3-flowstep-actions
    content: Flowstep — doing work via actions (invoke an action, hand a task to an App without becoming a Seat)
    status: pending
  - id: md4-flowstep-invite
    content: Flowstep — agent invited in (you stay owner; they do not claim or enter the gateway pool)
    status: pending
  - id: md5-open-questions
    content: Resolve open questions (persistence, runtime shape, window model, action catalog) after screens exist — then write an implementation slice; do not start code before that
    status: pending
isProject: true
---

# Desk — My Desk (backlog, design-first)

Sibling of [`desk_spec_workspace_ux.plan.md`](./desk_spec_workspace_ux.plan.md) (Build / Apps / Seats rename — in progress) and [`relay_desk_hitl_shell.plan.md`](./relay_desk_hitl_shell.plan.md) (pooled seats). Visual home: Flowstep [Relay Desk](https://app.flowstep.ai/file?activeFileId=a7a26c2d-f42b-4309-955c-7f931d81c6fe). Design system: [`apps/relay-desk/DESIGN.md`](../../apps/relay-desk/DESIGN.md).

**Status:** backlogged. Implementation is blocked until Flowstep screens exist and the open questions are answered. The workspace UX plan must not render this rail item or a placeholder surface.

## Why it exists

The current Console (now **Seats**) is a pool: any app or workflow can spin a computer, you claim / watch / park / recycle it, and you attend when an agent needs a human. That is the wrong model for *your* machine.

**My Desk** is the persistent computer that is only yours. You work there — files, session, actions — and you may invite an agent in. It never enters the gateway pool.

## Locked (2026-10-31)

| Lock | Rule |
|---|---|
| **Name** | `My Desk` (rail). Contrast: desks are personal and persistent; seats are claimed and released. |
| **Rail order** | Seats · Build · Apps · **My Desk** · (Settings footer). Fourth item; home-anchor, not first. |
| **Not a Seat** | No lease, no heartbeat, no park, no recycle. Never listed in the Seats inventory. Never claimed by an app run. |
| **Agency** | An agent acts on My Desk only by invitation from inside My Desk. Invitation is not a gateway acquire. |
| **Window model** | Until design says otherwise, live pixels stay in a separate WebView — do not embed a VNC mosaic in the main window ([DESIGN.md](../../apps/relay-desk/DESIGN.md) window model). |
| **Not this plan's job** | Seats behaviour, Build authoring, Apps fleet management. Cross-links only. |

## What to design (then stop)

Prototype in the existing Relay Desk Flowstep file. JSX / screens first; no Desk code.

1. **Rail** — four items on the current shell so the name has a home.
2. **Idle / home** — what is already on this computer; how you start; why this is not Seats (no pool count, no claim/park, no HITL inbox).
3. **Actions** — you do work via actions. How an action is picked, runs, and finishes. How you hand a task to an App without your Desk becoming a Seat.
4. **Agent invited** — you remain owner; the agent does not take a lease; exit is yours.

After those screens: resolve the questions below, then write a separate *implementation* slice. Do not start `app.tsx` work from this file.

## Open questions (design + later runtime)

- **Persistence.** Always-on dedicated worker, start/stop with Desk, or sleep with explicit wake? Files and session must survive a Desk restart — how?
- **Runtime shape.** New computer-with-agent profile that is excluded from `/v1/seats`, or a different host entirely? Must not be implementable as “a Seat we never recycle.”
- **Actions catalog.** Same verbs as Spec steps (`api.request`, `llm.generate`, …), a smaller personal set, or something new?
- **Apps from here.** Can My Desk launch an approved App in-place, or only deep-link to Apps / Seats?
- **Identity.** One My Desk per human per Desk install, or attachable later?

## Non-goals (until design lock)

- Rail item or stub route in the workspace UX implementation
- Reusing Seat claim / park / recycle / heartbeat chrome
- Multi-user or shared personal computers
- Baking a desktop into the Tauri binary ([`relay_desk_local_runtime.plan.md`](./relay_desk_local_runtime.plan.md) stays about optional local *seats*)

## Log

- 2026-10-31 — Opened as backlog after locking rail names Seats · Build · Apps · My Desk. Product rule written; implementation deferred until Flowstep.
