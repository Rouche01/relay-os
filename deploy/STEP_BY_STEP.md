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
| **Admin UI** (`pnpm admin:store`) | Loopback-only operator GUI on `127.0.0.1:8787` — tunnel from the laptop |
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

## 6. Admin UI on your laptop (SSH tunnel)

The admin server binds **`127.0.0.1` only** on the ThinkPad (not LAN). Use an SSH local forward from the laptop.

### 6a. On the ThinkPad — start admin (separate from the daemon)

SSH session A (or a second systemd/user unit later):

```bash
cd /opt/relay-community/app
set -a && source /opt/relay-community/env/community.env && set +a
pnpm --filter @relay/apps-community-engager admin:store
# → listening on http://127.0.0.1:8787
```

Leave this running.

### 6b. On the laptop — tunnel + browser

```bash
# Forwards laptop:8787 → thinkpad:127.0.0.1:8787
ssh -N -L 8787:127.0.0.1:8787 thinkpad
```

Open in the laptop browser:

**http://127.0.0.1:8787**

You should see Actions, Allowlist, Jobs, Runs, Authority, Schedules against ThinkPad data paths.

Tips:

| Tip | Detail |
|-----|--------|
| Port busy locally | `ssh -N -L 8788:127.0.0.1:8787 thinkpad` → open `http://127.0.0.1:8788` |
| Background tunnel | `ssh -fN -L 8787:127.0.0.1:8787 thinkpad` |
| SSH config | `LocalForward 8787 127.0.0.1:8787` under `Host thinkpad` |
| Do not | Bind admin to `0.0.0.0` or open 8787 on the router — keep loopback + tunnel |

Optional: same pattern for VoltMem UI if compose exposes loopback `8080`:

```bash
ssh -N -L 8080:127.0.0.1:8080 thinkpad
# http://127.0.0.1:8080/ui  (+ API key / tenant)
```

---

## 7. Verify end-to-end

| Check | How |
|-------|-----|
| Daemon up | `systemctl status relay-community-scheduler` / journal |
| Telegram ops | `/status`, `/help` (no HITL card pending) |
| HITL | Trigger `/engage` or wait for cadence; Approve stays dry-run |
| Admin | Tunnel open; Schedules / Runs reflect ThinkPad files |
| Cookie jar | No unexpected login wall on headless scout |

Full smoke table: [`SMOKE.md`](./SMOKE.md).

---

## 8. Day-to-day

| Situation | Action |
|-----------|--------|
| New release | [`CHECKLIST.md`](./CHECKLIST.md) §§ B–E, then `systemctl restart relay-community-scheduler` |
| CAPTCHA / expired jar | One-shot with `REDDIT_INTERSTITIAL_HITL=true` + remote desktop; see [`README.md`](./README.md) |
| Pause cadence overnight | Telegram `/stop_cadence` (or Admin → Schedules) |
| Live post | Flip `REDDIT_DRY_RUN=false` for a deliberate one-shot only |
| Host sleep | Disable lid/suspend if timers / Telegram poll must stay alive |

---

## Quick reference — copy/paste

**ThinkPad — update + daemon restart**

```bash
cd /opt/relay-community/app && git pull && pnpm install \
  && pnpm --filter @relay/apps-community-engager... build
sudo systemctl restart relay-community-scheduler.service
```

**ThinkPad — admin**

```bash
cd /opt/relay-community/app
set -a && source /opt/relay-community/env/community.env && set +a
pnpm --filter @relay/apps-community-engager admin:store
```

**Laptop — tunnel**

```bash
ssh -N -L 8787:127.0.0.1:8787 thinkpad
# browser → http://127.0.0.1:8787
```
