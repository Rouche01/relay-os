# Relay Desk — laptop install (Mac → ThinkPad or local)

Phase **p4** runbook: install Desk on a Mac, point it at a **remote** computer-with-agent gateway (ThinkPad / Tailscale) or a **local** Compose stack. Runtime deploy details stay in the sibling repo.

| Doc | Owns |
|-----|------|
| This file | Desk on the laptop: build, Settings, hosts, CE dogfood |
| [`DESIGN.md`](./DESIGN.md) | Console vs Spec, gateway topology |
| [computer-with-agent `AGENTS.md`](file:///Users/richardemate/Projects/computer-with-agent/AGENTS.md) | Compose workers, gateway env, ThinkPad port bind |
| [computer-with-agent `BINDING.md`](file:///Users/richardemate/Projects/computer-with-agent/BINDING.md) | Lease / park / recycle HTTP |
| [`deploy/CADDY.md`](../../deploy/CADDY.md) | Tailscale `.hsv` aliases + trusting Caddy’s local CA |
| [`.cursor/plans/relay_desk_local_runtime.plan.md`](../../.cursor/plans/relay_desk_local_runtime.plan.md) | Optional guided local runtime (deferred) |

## 1. Install Desk on the Mac

Prerequisites:

- Node **22+** / pnpm **9+** (monorepo `.nvmrc`)
- [Rust](https://rustup.rs/) stable + `source ~/.cargo/env` (or rustup on `PATH`)
- macOS: Xcode CLT

```bash
cd /path/to/relay-os
nvm use   # or: nvm install && nvm use
pnpm install
pnpm --filter @relay/apps-relay-desk tauri:dev
```

- Dev window: Tauri loads Vite (`localhost:1420` under the hood). Prefer **`tauri:dev`** so gateway calls use Rust (`gateway_http`) — no CORS.
- Typecheck: `pnpm --filter @relay/apps-relay-desk typecheck`
Settings persist in the webview `localStorage` (gateway URL, token, HITL URL, `job_id`).

### Personal macOS build (for you)

No notarization required for local/personal use (Gatekeeper may warn once — right-click → Open).

```bash
cd /path/to/relay-os
nvm use
pnpm install
pnpm --filter @relay/apps-relay-desk tauri:build
```

Artifacts (typical when `CARGO_TARGET_DIR` is unset):

- App: `apps/relay-desk/src-tauri/target/release/bundle/macos/Relay Desk.app`
- DMG: `apps/relay-desk/src-tauri/target/release/bundle/dmg/Relay Desk_*_aarch64.dmg`

Agent builds may also land under `apps/relay-desk/dist-bundle/` (copied `.app` + `.dmg`).

First open on macOS: right-click → **Open** if Gatekeeper blocks an unsigned personal build. Point Settings at `https://cu-gateway.hsv` or `http://127.0.0.1:9000` the same as in `tauri:dev`.

Public “download for anyone” (signed installers + local-runtime / BYO-gateway first-run) stays on [`relay_desk_local_runtime.plan.md`](../../.cursor/plans/relay_desk_local_runtime.plan.md).

## 2. Pick a gateway profile

Same Desk app; only Settings change.

| Profile | When | `COMPUTER_GATEWAY_URL` | Streams |
|---------|------|------------------------|---------|
| **Remote** | ThinkPad (or always-on host) runs Compose + Caddy | `https://cu-gateway.hsv` | `cu1.hsv` / `cu2.hsv` (from lease `vnc_url`) |
| **Local** | Compose on this Mac | `http://127.0.0.1:9000` | `localhost:6081` / `6082` |

Older docs may say `desk.hsv` / `desk1.hsv` / `desk2.hsv` — same pattern; use the hostnames your Caddyfile and `WORKER_VNC_URLS` actually publish.

### Remote checklist

1. **ThinkPad** — computer-with-agent Compose up; gateway healthy; ports on loopback; Caddy terminates TLS for `cu-gateway.hsv` (and noVNC hosts). See AGENTS.md “ThinkPad / Caddy”.
2. **Laptop `/etc/hosts`** (or MagicDNS) — map names to the ThinkPad **Tailscale IP**:

   ```text
   100.x.y.z  cu-gateway.hsv cu1.hsv cu2.hsv
   ```

3. **Trust Caddy Local Authority** on the Mac (Keychain) so browsers *and* Desk (reqwest native roots) accept `https://`. Steps: [`deploy/CADDY.md`](../../deploy/CADDY.md) § HTTPS / trust CA.
4. **Desk → Settings**
   - `COMPUTER_GATEWAY_URL` = `https://cu-gateway.hsv` (**https**, not http — avoid broken 308 follows)
   - `COMPUTER_API_TOKEN` = same as ThinkPad `COMPUTER_API_TOKEN`
   - `job_id` / `agent_id` as you use for CE (defaults `relay-desk`)
5. **Probe** in Settings — expect reachable. **Refresh seats** needs gateway build with `GET /v1/seats` (redeploy gateway image if 404).

### Local checklist

1. In `~/Projects/computer-with-agent`: `.env` from `.env.example`, then `docker compose up --build -d`.
2. `curl -s http://127.0.0.1:9000/health` → `free` / `workers`.
3. Desk Settings: `http://127.0.0.1:9000` + matching token (often `dev-token`).

## 3. Operator smoke (either profile)

From **Console**:

1. Probe gateway · Refresh seats  
2. **Open seat** → separate WebView (`Relay Desk · Seat`)  
3. **Park** / **Watch** / **Acquire** / **Recycle** as needed  
4. If `no free workers` → Refresh seats → Recycle abandoned **parked** rows  

HITL: set `DESK_HITL_URL` (e.g. `http://127.0.0.1:9100` when CE runs on the Mac, or a ThinkPad URL if CE is remote) → Probe HITL → Approve/Abort when CE presents.

## 4. CommunityEngager dogfood (computer + Desk)

On the host that runs CE (Mac or ThinkPad):

```bash
# community-engager .env (illustrative)
REDDIT_TRANSPORT=computer
REDDIT_DRY_RUN=true
COMMUNITY_POST_MODE=manual   # or auto when ready
COMPUTER_GATEWAY_URL=https://cu-gateway.hsv   # or http://127.0.0.1:9000
COMPUTER_API_TOKEN=<same as gateway>
FEEDBACK_ADAPTER=desk
DESK_HITL_PORT=9100
# DESK_HITL_TOKEN=optional
```

```bash
pnpm --filter @relay/apps-community-engager start
# or: FEEDBACK_ADAPTER=desk --adapter=desk
```

Desk Settings **DESK_HITL_URL** must reach that bridge (Tailscale hostname if CE is not local). Computer path is evidence-oriented; see CE README / engines-computer notes.

## 5. Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Probe TLS / certificate errors | Caddy CA not in Mac trust store; or using webpki-only client (Desk uses native roots) |
| `http://cu-gateway.hsv` fails | Use `https://`; Caddy may 308 |
| `list seats failed (404)` | ThinkPad gateway image predates `GET /v1/seats` — rebuild/redeploy **gateway** only |
| `no free workers` + parked &gt; 0 | Refresh seats → Recycle; or Acquire / same `job_id` reattach |
| Stream blank / wrong host | `WORKER_VNC_URLS` / `GATEWAY_PUBLIC_BASE` must be laptop-reachable `.hsv` (or localhost), not Docker-internal names |
| HITL never appears | `FEEDBACK_ADAPTER=desk`, Desk URL/token, CE process listening |

## 6. What Desk does *not* install

- Bundling computer-with-agent into the Tauri `.app` — out of scope; see local-runtime plan  
- Spec compiler — **Spec** sidebar surface is scaffold only  
- Replacing ThinkPad CE/systemd deploy — [`relay_thinkpad_deploy.plan.md`](../../.cursor/plans/relay_thinkpad_deploy.plan.md)  
