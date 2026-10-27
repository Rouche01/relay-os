---
name: Relay Desk — local computer runtime
overview: "Optional same-machine computer-with-agent for Relay Desk: v1 = guided Compose dependency (not baked into the Tauri binary); later = Docker-free native/local worker path. Keeps runtime sibling boundary; Desk stays a thin operator shell. Deferred — revisit after p4-thinkpad docs."
todos:
  - id: rt0-lock-profiles
    content: "Lock two Desk profiles in docs/Settings UX — Remote ThinkPad (desk.hsv) vs Local runtime (127.0.0.1:9000); Remote remains default for daily ops"
    status: pending
  - id: rt1-compose-contract
    content: "Define local Compose contract in computer-with-agent (ports, token, WORKER_VNC_URLS for localhost, health/ready/seats); document resource floor (RAM/CPU, Docker/Colima)"
    status: pending
  - id: rt2-desk-preset
    content: "Desk Settings — Local runtime preset (gateway URL/token) + Probe/Refresh seats; no silent auto-start yet"
    status: pending
  - id: rt3-guided-install
    content: "Guided local install — detect Docker or Colima; clone/pull computer-with-agent or use packaged compose dir; compose up; write Desk Settings; fail clearly if no engine"
    status: pending
  - id: rt4-optional-sidecar
    content: "Optional later — Tauri sidecar or menu action Start/Stop local runtime that shells compose (still requires container engine); never embed Linux desktop inside .app"
    status: pending
  - id: rt5-dockerless-spike
    content: "Spike Docker-free path — native macOS/Linux worker or single-process gateway+one seat without Compose; compare cost vs keeping Compose-only local"
    status: pending
  - id: rt6-dockerless-product
    content: "If spike wins — productize Docker-free local seat (API-compatible with /v1/sessions + /v1/seats); Desk profile switches engine without UI rewrite"
    status: pending
  - id: out-of-scope
    content: "Non-goals — bake XFCE/Firefox/noVNC into Tauri binary; merge computer-with-agent into relay-os; require local runtime for all Desk installs; K8s on-demand sandboxes in Desk"
    status: pending
isProject: true
---

# Relay Desk — local computer runtime (optional)

Deferred plan for **same-machine** computer seats alongside Relay Desk. Sibling of [`relay_desk_hitl_shell.plan.md`](./relay_desk_hitl_shell.plan.md) and the runtime at `~/Projects/computer-with-agent`. Revisit after Desk **p4-thinkpad** docs; do not block current Desk ship.

**Already true today:** one Desk app works with a **local** gateway (`127.0.0.1:9000`) or a **remote** one (`desk.hsv`) via Settings — documented in [`apps/relay-desk/README.md`](../../apps/relay-desk/README.md) and [`DESIGN.md`](../../apps/relay-desk/DESIGN.md). This plan only adds guided Local install + a future Docker-free engine.

## Why this exists

Operators sometimes want Desk + seats on one box (laptop dogfood, ThinkPad colocated). Today that works by manually running Compose and pointing Settings at `127.0.0.1:9000`. This plan makes that path **first-class and optional**, without pretending Linux workers can live inside the Tauri `.app`.

## Decision (locked)

| Choice | Verdict |
|--------|---------|
| Bake workers into Tauri binary | **No** — workers are Linux desktops (Xvfb/XFCE/Firefox/noVNC) |
| Optional local runtime | **Yes** — guided dependency on Compose (or later Docker-free engine) |
| Default install | **Remote** ThinkPad / `desk.hsv` (or existing remote URL) |
| Repo boundary | Runtime stays **`computer-with-agent`**; Desk stays thin shell |

```text
Desk (Tauri)
  ├─ Profile: Remote  → COMPUTER_GATEWAY_URL=http://desk.hsv …
  └─ Profile: Local   → 127.0.0.1:9000
         └─ v1: Docker/Colima + computer-with-agent Compose
         └─ later: Docker-free local engine (same HTTP API)
```

## Phase A — Profiles + contract (docs first)

1. **Two profiles** in Desk README / Settings copy:
   - **Remote** — gateway on ThinkPad (`desk.hsv`), streams `desk1`/`desk2`
   - **Local** — Compose on this machine; localhost gateway + localhost noVNC ports
2. **Contract** (computer-with-agent): documented env for laptop (`GATEWAY_PUBLIC_BASE`, `WORKER_VNC_URLS`, token), `GET /health` + `GET /v1/seats`, resource expectations.
3. Desk **Local preset** fills Settings; Probe / Refresh seats unchanged.

**Success:** An operator can choose Local vs Remote from docs/Settings without guessing ports.

## Phase B — Guided Compose install (recommended v1)

Not “bundle the runtime in the `.app`.” Instead:

1. Detect **Docker Desktop** or **Colima** (macOS) / Docker (Linux).
2. Ensure `computer-with-agent` sources or a **packaged compose project** (release artifact or submodule path).
3. `compose up -d` (or equivalent); wait for `/health` + `/v1/seats`.
4. Write Desk Settings (`127.0.0.1:9000`, token).
5. Hard fail with install link if no container engine.

Optional follow-on (**rt4**): Desk menu **Start / Stop local runtime** via shell/`docker compose` — still requires the engine; Tauri sidecar only wraps the control script, not the desktops.

**Success:** Checkbox or setup step “Run computer runtime on this Mac” works when Docker/Colima is present; Remote-only installs stay small.

## Phase C — Without Docker someday

Compose is the right **v1**. Docker-free is a **product decision**, not a packaging trick.

### Spike (**rt5**)

Evaluate at least one of:

- **Native worker** on macOS/Linux — single seat (browser window or embedded WebView drive), gateway in-process or small sidecar, API-compatible with `@relay/engines-computer`
- **Slimmer VM** (e.g. fixed Lima instance) if “real Linux Firefox” remains mandatory
- **Explicit no** — keep Compose-only local and document that

Criteria: lease / park / recycle / `vnc_url` (or Desk-native stream) / seats list; ops cost vs Compose; HITL dogfood parity.

### Productize (**rt6**) only if spike wins

- Same Desk Local profile; swap backend under Settings
- Do **not** merge full Compose stack into `relay-os` unless spike proves a thin native engine

**Success:** Local profile works with no Docker install, or we consciously reject that path.

## Non-goals

- Shipping XFCE/Firefox/noVNC inside the Tauri app bundle
- Merging `computer-with-agent` into relay-os for packaging convenience
- Making local runtime mandatory for Desk
- On-demand K8s sandboxes from Desk
- Replacing remote ThinkPad deploy ([`relay_thinkpad_deploy.plan.md`](./relay_thinkpad_deploy.plan.md))

## Relation to other plans

| Plan | Role |
|------|------|
| [`relay_desk_hitl_shell.plan.md`](./relay_desk_hitl_shell.plan.md) | Desk app; **p4-thinkpad** docs should link here for Local vs Remote |
| `computer-with-agent` AGENTS.md / BINDING.md | Runtime API + Compose |
| [`relay_thinkpad_deploy.plan.md`](./relay_thinkpad_deploy.plan.md) | Always-on host deploy (CE, etc.) — complementary, not replaced |

## Suggested revisit order

1. Finish Desk **p4** docs (Remote + pointer to Local manual Compose).
2. Return here → **rt0–rt3** (profiles + guided Compose).
3. Only then **rt4** sidecar controls / **rt5–rt6** Docker-free.
