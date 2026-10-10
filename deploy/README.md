# Relay Community — ThinkPad deploy

Dogfood layout for **CommunityEngager** + Telegram HITL on an always-on Linux box (ThinkPad).

Sibling plans:

- Host history / VoltMem layout: [`.cursor/plans/relay_thinkpad_deploy.plan.md`](../.cursor/plans/relay_thinkpad_deploy.plan.md)
- Browser transport + cookies: [`.cursor/plans/relay_reddit_browser.plan.md`](../.cursor/plans/relay_reddit_browser.plan.md)
- Decide co-processor (Jev / heuristic): [`.cursor/plans/jev_decide_integration_dd22a99c.plan.md`](../.cursor/plans/jev_decide_integration_dd22a99c.plan.md)
- Deploy checklist (ThinkPad): [`CHECKLIST.md`](./CHECKLIST.md)
- Smoke verification: [`SMOKE.md`](./SMOKE.md)

## Layout

```text
/opt/voltmem/                         # SHARED sidecar (own program)
├── env/sidecar.env
├── data/
└── deploy/docker-compose.yml

/opt/relay-community/                 # THIS APP ONLY
├── app/                              # relay-os clone
├── env/community.env                 # secrets (chmod 600)
├── data/
│   ├── action-store/                 # FileJson actions (optional override)
│   ├── jobs/                         # idempotent execute records
│   └── cookies/reddit/               # Playwright storageState jars
├── deploy/                           # copies of units from this folder
└── logs/
    └── runs/                         # per-run JSON (COMMUNITY_RUNS_DIR)
```

Each CommunityEngager invocation writes a structured summary to `COMMUNITY_RUNS_DIR`
(default `.data/runs/` locally). No tokens or passwords. Disable with `COMMUNITY_RUN_LOG=0`.

## Workspace slice (required packages)

CommunityEngager needs:

| Path | Why |
|------|-----|
| `apps/community-engager` | App |
| `packages/protocol` | Manifest / feedback |
| `packages/runtime` | AgentRuntime + fanout |
| `packages/action-store` | Draft lifecycle + ActionStore admin adapter |
| `packages/admin-shell` | Loopback operator GUI (used by `admin:store`) |
| `packages/feedback-broker` | HITL broker |
| `packages/adapters-telegram` | Telegram Approve/Abort |
| `packages/context-engine` | VoltMem client |
| `packages/engines-browser` | **Required** — Playwright scout / login / comment + observe |
| `packages/engines-decide` | **Required** — discover fit / page-class / login / composer Choice |

Optional: `packages/llm-controller` (legacy semantic helpers; prefer DecisionPort).

**Not required:** `newsletter-migrator`, living-todo UI.

Full clone under `/opt/relay-community/app` is fine for v1.

## One-time host setup

### 1. Trees

```bash
sudo mkdir -p /opt/voltmem/{env,data,deploy,logs}
sudo mkdir -p /opt/relay-community/{app,env,data/action-store,data/jobs,data/cookies/reddit,deploy,logs}
sudo chown -R "$USER:$USER" /opt/voltmem /opt/relay-community
chmod 700 /opt/relay-community/env /opt/relay-community/data/cookies
```

### 2. Sync + build

```bash
git clone <relay-os-url> /opt/relay-community/app
cd /opt/relay-community/app
pnpm install
pnpm --filter @relay/apps-community-engager... build
```

### 3. Chromium (Playwright)

Browser scout/login/execute need a Chromium binary **and** OS libs:

```bash
cd /opt/relay-community/app
pnpm --filter @relay/engines-browser exec playwright install chromium
pnpm --filter @relay/engines-browser exec playwright install-deps chromium
# or: sudo npx playwright install-deps chromium
```

Headless timer runs use `REDDIT_BROWSER_HEADLESS=true` (default). First cookie jar / CAPTCHA pass needs a human (see re-auth below).

### 4. Env

```bash
cp /opt/relay-community/app/deploy/community.env.example /opt/relay-community/env/community.env
chmod 600 /opt/relay-community/env/community.env
# edit: Telegram, VoltMem, Reddit paths, DRY_RUN=true
```

ThinkPad paths that matter:

```bash
REDDIT_DATA_DIR=/opt/relay-community/data
REDDIT_COOKIE_DIR=/opt/relay-community/data/cookies/reddit
ACTION_STORE_PATH=/opt/relay-community/data/action-store/actions.json
JOBS_DIR=/opt/relay-community/data/jobs
COMMUNITY_RUNS_DIR=/opt/relay-community/logs/runs
# ALLOWLIST_PATH defaults to $REDDIT_DATA_DIR/allowlist/subreddits.json
FEEDBACK_ADAPTER=telegram
REDDIT_DRY_RUN=true
SCOUT_SOURCE=auto
REDDIT_TRANSPORT=auto
REDDIT_BROWSER_HEADLESS=true
# Unattended timers: leave interstitial HITL off (default when headless)
# Prep jar interactively once — see "Re-auth" below

# Decide co-processor — overnight safe default (no Jev network):
DECIDE_BACKEND=heuristic
# Live Jev only when deliberately enabled (needs key; not for unattended timer):
# DECIDE_BACKEND=jev
# JEV_API_KEY=
# JEV_BASE_URL=https://api.typesafe.ai/v1/systemone
```

### Operator admin GUI (loopback)

Browse/edit actions + allowlist, inspect jobs/runs (with run charts):

```bash
cd /opt/relay-community/app
set -a && source /opt/relay-community/env/community.env && set +a
pnpm --filter @relay/apps-community-engager admin:store
# → http://127.0.0.1:8787  (SSH tunnel if remote)
```

Each collection uses its own path env above — runs can stay under `logs/runs` while actions live under `data/action-store`.

### 5. Manual smoke (before systemd)

```bash
cd /opt/relay-community/app/apps/community-engager
set -a && source /opt/relay-community/env/community.env && set +a
node dist/run-dev.js
```

Expect Telegram HITL for drafts; dry-run execute logs only. See [`SMOKE.md`](./SMOKE.md).

### VoltMem domains file

Fact kinds for this app are `apps/community-engager/voltmem-domains.json` (`community_preference` 0.20, `community_rules` 0.15, `community_outcome` 0.55). The sidecar Community Engager talks to must load that file. On the shared VoltMem program:

```bash
# /opt/voltmem/env/sidecar.env
VOLTMEM_DOMAINS_FILE=/domains/community.json
```

Mount the file into the container (read-only) next to the data volume:

```yaml
volumes:
  - /opt/voltmem/data:/data
  - /opt/relay-community/app/apps/community-engager/voltmem-domains.json:/domains/community.json:ro
```

`VOLTMEM_TENANT_ID` in `community.env` is the tenant (`relay-community`). `VOLTMEM_USER_ID` is still read when `VOLTMEM_TENANT_ID` is unset. Writes send the domain name, so the sidecar uses the file's volatility instead of the stylens classifier.

### 6. systemd units

`run-dev.js` is a **one-shot** (scout → jobs → exit), not a daemon.

```bash
cd /opt/relay-community/app/deploy
cp relay-community.service.example relay-community.service
cp relay-community.timer.example relay-community.timer

which node   # systemd cannot see nvm — paste absolute path into ExecStart
whoami
```

Edit `relay-community.service`: set `User=` / `Group=` and absolute `node` in `ExecStart=`.

```bash
sudo cp relay-community.service /etc/systemd/system/
sudo cp relay-community.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start relay-community.service
journalctl -u relay-community.service -n 80 --no-pager
```

Optional schedule (default 07:00 local):

```bash
sudo systemctl enable --now relay-community.timer
systemctl list-timers | grep relay
```

## Browser modes: headless timer vs headed walls

Telegram never streams pixels. CAPTCHA / login need a **real headed Chromium on the ThinkPad** plus remote desktop into that session.

| Mode | When | Env | Behaviour |
|------|------|-----|-----------|
| **Timer / overnight** | Jar healthy | `REDDIT_BROWSER_HEADLESS=true`, leave `REDDIT_INTERSTITIAL_HITL` unset/false | Headless scout; walls → skip/log, no hang |
| **Wall clear / re-auth** | Jar expired or CAPTCHA | `REDDIT_INTERSTITIAL_HITL=true` (+ display) | Headless until obstruction, then **reopens headed**; Telegram pauses until you solve + Approve |

Discover already did headless→headed on escalate; scout now matches that.

### Recommended ThinkPad setup

1. Keep a **logged-in graphical session** on the box (or a dedicated X user session), not a pure SSH-only host.
2. Install **remote desktop** into that session (RustDesk, Tailscale + WayVNC/x11vnc, or similar) — open it only when Telegram says a wall is up.
3. Timer unit stays headless + HITL off so overnight runs never block on you.
4. When a run log shows blocked / you get a CAPTCHA Telegram card: either flip HITL for a one-shot, or run headed login (below).

### Re-auth when the cookie jar expires

Do **not** rely on `REDDIT_PASSWORD` in env for day-to-day (optional bootstrap only). Prefer HITL:

1. **Missing jar / live write needs session** — run once with Telegram:
   ```bash
   # in community.env for this one-shot:
   REDDIT_ENSURE_SESSION=true
   FEEDBACK_ADAPTER=telegram
   REDDIT_LOGIN_HEADED=true          # needs display + remote desktop
   REDDIT_INTERSTITIAL_HITL=true
   ```
   Or: `pnpm --filter @relay/apps-community-engager login:reddit` with env loaded.

2. **“Prove your humanity” mid-scout** — interactive pass with HITL on:
   ```bash
   REDDIT_BROWSER_HEADLESS=true      # still start headless
   REDDIT_INTERSTITIAL_HITL=true     # on wall → reopen headed + Telegram wait
   ```
   Solve CAPTCHA in the headed window via remote desktop; Approve (or wait for auto-clear). Jar saves under `REDDIT_COOKIE_DIR`. Then restore timer env (HITL off).

3. **Backup:** copy a fresh jar from a laptop onto `/opt/relay-community/data/cookies/reddit/` (`chmod 700` on the directory).

4. Jar files: `{account}.storage.json` under that cookie dir.

## Host power

If Telegram long-poll or morning timers must fire, disable suspend / lid-close sleep at the **machine** level (shared server policy — not app config).

## Safety

| Rule | Value |
|------|--------|
| Dry-run default | `REDDIT_DRY_RUN=true` until you intentionally flip |
| Nothing posts without Approve | Abort skips execute |
| CAPTCHAs | Never auto-solved; human in headed browser only |
| Secrets | Only in `/opt/relay-community/env/community.env` (mode 600) |
