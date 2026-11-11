---
name: Computer Phone Seat Bind
overview: Extend @relay/engines-computer and @relay/browse-policy to lease and drive computer-with-agent phone seats (kind=phone, swipe/observe/ref) while keeping desktop behavior unchanged—so agents can run a watchable phone flow against the same gateway.
todos:
  - id: engine-kind-lease
    content: "ComputerEngine: lease kind (desktop|phone), surface kind/seat_id/vnc_url; default desktop"
    status: completed
  - id: engine-phone-actions
    content: Widen ComputerActionPayload for swipe/long_press/launch/ref/duration_ms; add observe execute type
    status: completed
  - id: engine-tests
    content: Unit tests for kind on lease body + phone action/observe HTTP mapping
    status: pending
  - id: browse-phone-goal
    content: "browse-policy: phone goal/task + system prompt + swipe-heavy actionMix; optional observe observations"
    status: pending
  - id: dogfood-script
    content: Small runnable dogfood (script or task) — lease phone, print HITL URL, run short goal, park
    status: pending
  - id: docs-note
    content: Package READMEs + pointer back to computer-with-agent AGENTS.md phone bind notes
    status: pending
isProject: false
---

# Bind Relay to computer-with-agent phone seats

## Context (already shipped upstream)

[computer-with-agent](file:///Users/richardemate/Projects/computer-with-agent) now supports:

- Inventory seats with `kind: "desktop" | "phone"`
- `POST /v1/sessions` with `{ "kind": "phone" }`
- Phone actions: `tap`/`click`, `swipe`, `long_press`, `launch`, Android `key` (`back`/`home`/`recents`), optional `ref`
- `GET /v1/sessions/{id}/observe` — screenshot + trimmed UIAutomator `elements[]`
- Park soft force-stop / recycle `pm clear` on the phone worker
- HITL via lease `vnc_url` (scrcpy-web when configured; physical device OK for dogfood)

Relay today: [`@relay/engines-computer`](packages/engines-computer) leases **desktop-only** (no `kind`); [`@relay/browse-policy`](packages/browse-policy) assumes Firefox navigate + click/scroll/type/key.

## Repo decision (locked)

**Work in relay-os only** for this plan. Do not change computer-with-agent unless a contract bug is found.

| Package | Role |
|---------|------|
| `@relay/engines-computer` | Typed gateway client — lease kind, actions, observe |
| `@relay/browse-policy` | Phone-aware goal loop / prompts / action-mix |
| Apps (optional dogfood) | Thin script or CE preview — not CommunityEngager phone transport yet |

CommunityEngager stays **desktop evidence-only** unless a later explicit phone transport is designed.

## Architecture

```mermaid
flowchart LR
  subgraph relay [relay-os]
    BP[browse-policy phone goal]
    CE[ComputerEngine]
  end
  subgraph cwa [computer-with-agent]
    GW[Gateway kind filter]
    Phone[phone-1 ADB worker]
  end
  Human[HITL scrcpy or device]
  BP --> CE
  CE -->|"lease kind=phone"| GW
  CE -->|screenshot observe action| GW
  GW --> Phone
  GW -->|vnc_url| Human
```

## Phase 1 — `@relay/engines-computer`

### Lease

- Add `kind?: "desktop" | "phone"` to `ComputerLeaseParams` (default omit / `"desktop"` — zero change for existing callers).
- Include `kind` in `POST /v1/sessions` JSON body.
- Extend `ComputerLeaseInfo` with optional `kind`, `seat_id` from gateway response.
- Store on engine: `getKind()`, keep `getVncUrl()` for HITL (same field for noVNC or scrcpy-web).

### Actions

Widen `ComputerActionPayload`:

| Field | Use |
|-------|-----|
| `x1,y1,x2,y2`, `duration_ms` | swipe / long_press |
| `package`, `uri` | launch |
| `ref` | tap/long_press by observe ref |

Gateway already forwards these; engine only needs types + pass-through (already posts `params.action` as JSON).

### Observe

- New execute type `"observe"` → `GET /v1/sessions/{id}/observe?max_elements=…`
- Result data: `{ image, elements, geometry?, element_count }`
- Desktop workers return 404 — engine should surface a clear error (or document phone-only).

### Tests

- Mock fetch: lease body includes `kind: "phone"` when requested.
- Action payload with swipe/ref forwarded unchanged.
- Observe maps to GET `/observe`.

## Phase 2 — `@relay/browse-policy`

### Phone browse goal

- Extend `BrowseGoal` / task options with `seatKind?: "desktop" | "phone"` (default desktop).
- When phone: pass `kind: "phone"` on lease; **skip** `navigateToUrl` / Firefox address-bar helpers (use `launch` / `uri` or start from current screen).
- Prompt: phone system chrome (`home`/`back`/`recents`), swipe-heavy priors, no `ctrl+l` chords.
- `BrowseActionMixPriors`: add `swipe`, `long_press`, `launch` (soft weights in prompt).

### Observation mode

- Option `observeMode?: "screenshot" | "observe"` (phone default `"observe"` once stable; desktop stays screenshot).
- When observe: feed image + compact element list (ref/text/desc/clickable) into the decide prompt; allow model to emit `ref` taps.

### Timing

- Reuse existing Exp/lognormal waits; optionally slightly higher swipe settle ms for phone animations (config, not magic).

## Phase 3 — Dogfood (watchable)

Small runnable entry (prefer package script or `engines-computer` example over a new app):

```text
COMPUTER_GATEWAY_URL=http://localhost:9000
COMPUTER_API_TOKEN=…
# Gateway inventory must include a free phone seat
```

1. Lease `kind=phone`
2. Print `Watch: {vnc_url}` (and/or “watch the physical device”)
3. Run a short goal e.g. “Open Settings and open About phone” via browse-policy phone task **or** a fixed 5-step script if LLM not configured
4. Soft-park (not recycle) by default

Prereq on machine: A55 reachable via ADB to whatever hosts `phone-1` (local uvicorn :8000 or Compose profile `phone`).

## Non-goals

- Changing computer-with-agent gateway/worker contracts
- iOS / Appium / Phone Harness cloud adapter (upstream phase 3)
- Wiring CommunityEngager or Reddit flows to phone
- Auto CAPTCHA / 2FA
- Requiring scrcpy-web before dogfood (physical screen is enough)

## Dogfood checklist

- [ ] `ComputerEngine` lease `{ kind: "phone" }` returns phone `seat_id` / `vnc_url`
- [ ] Desktop lease callers unchanged (no kind → desktop)
- [ ] Swipe + home key + launch Settings succeed through engine
- [ ] `observe` returns elements; tap by `ref` works
- [ ] Phone browse goal skips Firefox navigate; prints HITL URL
- [ ] Soft park leaves app data; recycle still available explicitly

## Open choices (resolve in first PR)

1. **Default phone observation:** screenshot-only first PR vs observe-from-day-one.
2. **Dogfood home:** `packages/engines-computer/scripts/…` vs tiny `apps/` CLI vs Desk button later.
3. **navigate on phone:** `launch` package only vs also `am start` http(s) `uri` as “open URL in browser app”.

## Implementation order

1. Engine types + lease `kind` + tests
2. Observe + payload fields + tests
3. browse-policy phone prompt/task
4. Dogfood script + README notes