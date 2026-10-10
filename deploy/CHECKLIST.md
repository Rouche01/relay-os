# ThinkPad update checklist

You already have v1 on the box (`/opt/relay-community`, systemd, env, cookies).
This is what to do for **each new release** — not a from-scratch install.

Full layout / first-time steps: `[README.md](./README.md)`.  
Verification table: `[SMOKE.md](./SMOKE.md)`.

Keep `REDDIT_DRY_RUN=true` on the timer until you deliberately go live.

**VoltMem split (important):**


| Need                        | What                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Yes — always (if memory on) | **Sidecar Docker image** running under `/opt/voltmem` (`ghcr.io/rouche01/voltmem-sidecar` or your compose) |
| No                          | Sibling git checkout of the voltmem **source** repo next to relay-os                                       |


`@voltmem/client` (npm) only talks HTTP to that container.

---



## A. On your laptop (before the ThinkPad)

- [x] Changes you care about are committed and pushed to the remote the ThinkPad tracks
- [x] Especially: `pnpm-lock.yaml` (published `@voltmem/client` — no sibling voltmem **source** checkout)
- [x] Optional local sanity: `pnpm --filter @relay/apps-community-engager... build && pnpm --filter @relay/apps-community-engager test`

---



## B. On the ThinkPad — pull + rebuild

Do **not** recreate trees. Do **not** wipe `env/` or `cookies/` unless you mean to.

```bash
cd /opt/relay-community/app
git pull
pnpm install
pnpm --filter @relay/apps-community-engager... build
```

Only if Playwright/Chromium bumped in the release:

```bash
pnpm --filter @relay/engines-browser exec playwright install chromium
# rarely: install-deps again if OS libs changed
```

- [x] `git pull` clean (or conflicts resolved)
- [x] `pnpm install` + build OK (`apps/community-engager/dist/run-dev.js` fresh)
- [x] No sibling voltmem **source** tree required (client comes from npm)

---



## C. Env — merge deltas only

Compare example → live (do not overwrite secrets blindly):

```bash
diff -u /opt/relay-community/env/community.env \
        /opt/relay-community/app/deploy/community.env.example | less
```

Timer should still look like:


| Knob                       | Keep                                 |
| -------------------------- | ------------------------------------ |
| `REDDIT_DRY_RUN`           | `true`                               |
| `REDDIT_BROWSER_HEADLESS`  | `true`                               |
| `REDDIT_INTERSTITIAL_HITL` | unset / false                        |
| `DECIDE_BACKEND`           | `heuristic` (overnight)              |
| Paths / Telegram / VoltMem | unchanged unless you intend a change |


New knobs worth adding when present in example (optional):

- Discover TTL: `COMMUNITY_DISCOVER_REQUEUE_DAYS=14`
- Leave Jev off on the timer unless dogfooding

- [ ] Diff reviewed; only intended keys edited
- [ ] `chmod 600` still on `community.env`

---



## D. VoltMem sidecar **image** (required for memory)

CommunityEngager does **not** embed the engine. Memory needs the VoltMem **sidecar container** running on the ThinkPad (usually `/opt/voltmem` + compose). npm only supplies the HTTP client.

```bash
# typical layout
cd /opt/voltmem/deploy   # or wherever docker-compose.yml lives
docker compose ps
curl -s http://127.0.0.1:8080/health
# expect: {"status":"ok"}
```

If the container is down:

```bash
cd /opt/voltmem/deploy
docker compose up -d
# after pulling a newer sidecar tag (optional):
# docker compose pull && docker compose up -d
```

Point `community.env` at it (`VOLTMEM_URL`, `VOLTMEM_API_KEY`, `VOLTMEM_TENANT_ID`).

Domains JSON is still a **volume on that container** (not replaced by npm):

```bash
# /opt/voltmem/env/sidecar.env
VOLTMEM_DOMAINS_FILE=/domains/community.json
```

```yaml
# compose volume example
volumes:
  - /opt/voltmem/data:/data
  - /opt/relay-community/app/apps/community-engager/voltmem-domains.json:/domains/community.json:ro
```

- [ ] Sidecar **container** is running (`docker compose ps` / `docker ps`)
- [ ] `curl` health OK (or run log: `Memory: voltmem (sidecar ok)`)
- [ ] `VOLTMEM_*` in `community.env` match the container
- [ ] Domains file still mounted; `VOLTMEM_DOMAINS_FILE` set
- [ ] If `voltmem-domains.json` changed in the app pull: `docker compose restart` (or recreate) so the mount is re-read

Skipping the sidecar is only OK if you accept fail-open memory (scout/HITL still work; facts/events won’t stick).

### Optional — expose `/ui` on the ThinkPad (Tailscale)

Default compose binds `127.0.0.1:8080` (loopback only). To open the memory browser as `http://hsv:8080/ui` from your laptop:

```yaml
# /opt/voltmem/deploy/docker-compose.yml — change ports to:
ports:
  - "8080:8080"    # was "127.0.0.1:8080:8080"
```

```bash
cd /opt/voltmem/deploy
docker compose up -d
curl -s http://127.0.0.1:8080/health
# from laptop: http://hsv:8080/ui — paste VOLTMEM_API_KEY + tenant (relay-community)
```

Prefer Tailscale-only reachability (don’t port-forward 8080 on the public LAN/router). `/ui` is unauthenticated HTML; API calls still need the key.

---



## E. Smoke the new build

```bash
cd /opt/relay-community/app/apps/community-engager
set -a && source /opt/relay-community/env/community.env && set +a
# confirm: DRY_RUN=true, HEADLESS=true, INTERSTITIAL_HITL off
node dist/run-dev.js
```

Or kick systemd once:

```bash
sudo systemctl start relay-community.service
journalctl -u relay-community.service -n 80 --no-pager
```

- [ ] Jar still loads (no unexpected login wall)
- [ ] Scout headless; no hang
- [ ] Telegram drafts (or clean empty scout if everything already-seen)
- [ ] Approve → dry-run only
- [ ] New run JSON under `COMMUNITY_RUNS_DIR` / `/opt/relay-community/logs/runs/`

If systemd unit examples changed and you customized them:

```bash
# review only — copy carefully
diff -u /etc/systemd/system/relay-community.service \
        /opt/relay-community/app/deploy/relay-community.service.example
# then: sudo cp … && sudo systemctl daemon-reload
```

- [ ] Timer still enabled (`systemctl list-timers | grep relay`) if you use it

---



## F. Day-to-day (unchanged)


| Situation                      | Action                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Morning timer                  | Check Telegram + `logs/runs/`                                                                                                                     |
| Cookie / CAPTCHA wall          | One-shot with `REDDIT_INTERSTITIAL_HITL=true` (+ `REDDIT_LOGIN_HEADED=true` if login); solve via remote desktop; Approve; **turn HITL off again** |
| Empty scout (all already-seen) | Optional: trim actions under `REDDIT_DATA_DIR` for dogfood only                                                                                   |
| Live post                      | Flip `REDDIT_DRY_RUN=false` for a deliberate one-shot only — not on first timer after a big update                                                |




### Wall clear one-shot (do not leave on timer)

```bash
cd /opt/relay-community/app/apps/community-engager
set -a && source /opt/relay-community/env/community.env && set +a
export REDDIT_INTERSTITIAL_HITL=true
# export REDDIT_LOGIN_HEADED=true   # if jar missing / login form
node dist/run-dev.js
# then unset / restore community.env — HITL off for timer
```

Needs graphical session + remote desktop (Telegram has no pixel stream).

---



## G. Browser modes (reminder)


|                            | Timer      | Wall clear                        |
| -------------------------- | ---------- | --------------------------------- |
| Headless                   | `true`     | `true` (starts headless)          |
| `REDDIT_INTERSTITIAL_HITL` | off        | `true`                            |
| On CAPTCHA                 | skip / log | reopen **headed** → Telegram wait |


---



## Done for this update when

- [ ] ThinkPad is on the new commit + rebuild
- [ ] VoltMem **sidecar container** healthy (if memory enabled)
- [ ] Smoke or service run COMPLETE with dry-run
- [ ] Timer env still HITL-off / dry-run
- [ ] Jar intact (or re-authed once)

---



## Appendix — greenfield only

If this machine has **no** `/opt/relay-community` yet, follow `[README.md](./README.md)` §§ trees → Chromium → env → jar → systemd, then use this checklist for every later update.