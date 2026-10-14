# ThinkPad deploy — step by step

End-to-end runbook to get **CommunityEngager** running on the ThinkPad and open the **admin UI from your laptop**.

Companion docs:

- Layout / deep reference: [`README.md`](./README.md)
- Per-release checklist: [`CHECKLIST.md`](./CHECKLIST.md)
- Smoke table: [`SMOKE.md`](./SMOKE.md)

Keep `REDDIT_DRY_RUN=true` until you deliberately go live.

---

## What you will run

| Process | Role |
|---------|------|
| **Ops daemon** (`pnpm scheduler` / `run-scheduler.js`) | Long-lived: cadence + post_watch schedules, Telegram idle ops (`/status`, `/engage`, …), HITL via Telegram |
| **Admin UI** (`relay-community-admin.service`) | Operator GUI on `:8787` — always-on unit; `ADMIN_HOST=0.0.0.0` for Tailscale (`http://hsv:8787`) |
| **VoltMem sidecar** (Docker) | Memory HTTP API on `127.0.0.1:8080` |
| **Optional timer** (`relay-community.timer`) | Legacy one-shot morning `run-dev.js` — skip if the ops daemon owns cadence |

---

## 0. Prerequisites (laptop)

- [ ] SSH access to the ThinkPad (hostname below = `thinkpad`; change to yours, e.g. Tailscale name)
- [ ] Repo remote the ThinkPad can `git pull` (changes pushed)
- [ ] Telegram bot token + your numeric user id (BotFather; no `/setcommands` needed — daemon registers `/` via API)

```bash
# From laptop — sanity
ssh thinkpad 'hostname && whoami && node -v'
```

Need Node **≥ 22** on the ThinkPad (`nvm` / apt / nodesource). systemd must use an **absolute** `node` path (not nvm shims).

---

## 1. First-time trees (skip if `/opt/relay-community` already exists)

On the **ThinkPad**:

```bash
sudo mkdir -p /opt/voltmem/{env,data,deploy,logs}
sudo mkdir -p /opt/relay-community/{app,env,data/action-store,data/jobs,data/cookies/reddit,deploy,logs}
sudo chown -R "$USER:$USER" /opt/voltmem /opt/relay-community
chmod 700 /opt/relay-community/env /opt/relay-community/data/cookies
```

Clone (or reuse existing app tree):

```bash
git clone <relay-os-url> /opt/relay-community/app
# or: cd /opt/relay-community/app && git remote -v
```

---

## 2. Pull + build

On the **ThinkPad**:

```bash
cd /opt/relay-community/app
git pull
pnpm install
pnpm --filter @relay/apps-community-engager... build
```

Chromium (first time, or after Playwright bumps). Needs **Playwright ≥ 1.61** for Ubuntu 26.04 (this repo pins `^1.61.0`):

```bash
pnpm --filter @relay/engines-browser exec playwright install chromium
pnpm --filter @relay/engines-browser exec playwright install-deps chromium
```

If you somehow still see `does not support chromium on ubuntu26.04-x64`, confirm `pnpm why playwright` shows ≥ 1.61, then reinstall — do **not** need `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` on current main.

- [ ] Build finishes without errors
- [ ] `apps/community-engager/dist/host/run-scheduler.js` exists

---

## 3. Env file

```bash
# First time only:
cp /opt/relay-community/app/deploy/community.env.example \
   /opt/relay-community/env/community.env
chmod 600 /opt/relay-community/env/community.env

# Updates: merge, do not overwrite secrets
diff -u /opt/relay-community/env/community.env \
        /opt/relay-community/app/deploy/community.env.example | less
```

Minimum keys for this deploy:

```bash
FEEDBACK_ADAPTER=telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWLIST_USER_ID=...   # your numeric id

REDDIT_DATA_DIR=/opt/relay-community/data
REDDIT_COOKIE_DIR=/opt/relay-community/data/cookies/reddit
ACTION_STORE_PATH=/opt/relay-community/data/action-store/actions.json
JOBS_DIR=/opt/relay-community/data/jobs
COMMUNITY_RUNS_DIR=/opt/relay-community/logs/runs

REDDIT_DRY_RUN=true
REDDIT_BROWSER_HEADLESS=true
# leave REDDIT_INTERSTITIAL_HITL unset for unattended

DECIDE_BACKEND=heuristic

VOLTMEM_URL=http://127.0.0.1:8080
VOLTMEM_API_KEY=...
VOLTMEM_TENANT_ID=relay-community
```

Optional admin port override (default **8787**):

```bash
# ACTION_STORE_ADMIN_PORT=8787
```

---

## 4. VoltMem sidecar

```bash
cd /opt/voltmem/deploy   # or your compose dir
docker compose ps
curl -s http://127.0.0.1:8080/health
# expect ok / healthy

# if down:
docker compose up -d
```

Domains mount (once): point compose at  
`/opt/relay-community/app/apps/community-engager/voltmem-domains.json`  
and set `VOLTMEM_DOMAINS_FILE=/domains/community.json` in sidecar env. Details: [`README.md`](./README.md).

- [ ] Health check OK
- [ ] `VOLTMEM_*` in `community.env` match the container

---

## 5. Ops daemon (recommended)

### 5a. Manual smoke (foreground)

```bash
cd /opt/relay-community/app
set -a && source /opt/relay-community/env/community.env && set +a
pnpm --filter @relay/apps-community-engager scheduler
```

Expect:

- Log: `Feedback adapter: telegram (idle → ops; / commands registered)`
- In Telegram: `/` picker shows ops commands; `/status` replies
- HITL cards still use Approve / Abort buttons

Ctrl+C when satisfied, then install systemd.

### 5b. systemd unit

```bash
which node   # e.g. /home/YOU/.nvm/versions/node/v22.22.3/bin/node
whoami
```

```bash
cd /opt/relay-community/app/deploy
cp relay-community-scheduler.service.example relay-community-scheduler.service
# Edit User=, Group=, HOME=, ExecStart= absolute node path
sudo cp relay-community-scheduler.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now relay-community-scheduler.service
journalctl -u relay-community-scheduler.service -f
```

If you previously used the **morning timer** (`relay-community.timer` → one-shot `run-dev.js`) and cadence now lives in the ops daemon, disable the timer to avoid double runs:

```bash
sudo systemctl disable --now relay-community.timer
```

---

## 6. Admin UI on your laptop (systemd + Tailscale)

Run admin as a system unit (same pattern as the ops daemon). Default bind is loopback; for MagicDNS access like VoltMem (`http://hsv:8080/ui/`), bind all interfaces on the ThinkPad and reach it only over Tailscale.

### 6a. On the ThinkPad — install admin unit

```bash
which node
whoami

cd /opt/relay-community/app/deploy
cp relay-community-admin.service.example relay-community-admin.service
# Edit User=, Group=, HOME=, ExecStart= absolute node path (same values as the scheduler unit)
sudo cp relay-community-admin.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now relay-community-admin.service
systemctl status relay-community-admin.service --no-pager
```

### 6b. Bind for Tailscale (recommended dogfood)

In `/opt/relay-community/env/community.env` (or `/opt/relay-os/env/community.env`):

```bash
ADMIN_HOST=0.0.0.0
# ACTION_STORE_ADMIN_PORT=8787   # optional; default 8787
```

```bash
sudo systemctl restart relay-community-admin.service
journalctl -u relay-community-admin.service -n 20 --no-pager
# expect: listening on http://0.0.0.0:8787
```

From the laptop (same Tailscale net as VoltMem):

**http://hsv:8787**  
(use your MagicDNS name if not `hsv`)

The UI has **no login** — same caution as VoltMem `/ui`: Tailscale-only, do not port-forward `8787` on the public router/LAN.

Verify listen:

```bash
ss -ltnp | grep 8787
# 0.0.0.0:8787  → reachable via hsv
# 127.0.0.1:8787 → Tailscale URL will fail; use SSH tunnel instead
```

### 6c. Loopback-only + SSH tunnel (stricter)

Omit `ADMIN_HOST` (or set `127.0.0.1`), then:

```bash
ssh -N -L 8787:127.0.0.1:8787 hsv
# browser → http://127.0.0.1:8787
```

Foreground escape hatch (debug only — stop the unit first):

```bash
sudo systemctl stop relay-community-admin.service
cd /opt/relay-community/app
set -a && source /opt/relay-community/env/community.env && set +a
pnpm --filter @relay/apps-community-engager admin:store
```

---

## 7. Verify end-to-end

| Check | How |
|-------|-----|
| Daemon up | `systemctl status relay-community-scheduler` / journal |
| Telegram ops | `/status`, `/help` (no HITL card pending) |
| HITL | Trigger `/engage` or wait for cadence; Approve stays dry-run |
| Admin | `systemctl is-active relay-community-admin`; `http://hsv:8787` (or tunnel); Schedules / Runs reflect ThinkPad files |
| Cookie jar | No unexpected login wall on headless scout |

Full smoke table: [`SMOKE.md`](./SMOKE.md).

---

## 8. Day-to-day

| Situation | Action |
|-----------|--------|
| New release | [`CHECKLIST.md`](./CHECKLIST.md) §§ B–E, then `systemctl restart relay-community-scheduler relay-community-admin` |
| CAPTCHA / expired jar | One-shot with `REDDIT_INTERSTITIAL_HITL=true` + remote desktop; see [`README.md`](./README.md) |
| Pause cadence overnight | Telegram `/stop_cadence` (or Admin → Schedules) |
| Live post | Flip `REDDIT_DRY_RUN=false` for a deliberate one-shot only |
| Host sleep | Disable lid/suspend if timers / Telegram poll must stay alive |

---

## Quick reference — copy/paste

**ThinkPad — update + restart services**

```bash
cd /opt/relay-community/app && git pull && pnpm install \
  && pnpm --filter @relay/apps-community-engager... build
sudo systemctl restart relay-community-scheduler.service relay-community-admin.service
```

**Laptop — admin**

```bash
# With ADMIN_HOST=0.0.0.0 on the ThinkPad:
open http://hsv:8787
# Or loopback-only: ssh -N -L 8787:127.0.0.1:8787 hsv
```
