# ThinkPad update checklist

You already have v1 on the box (`/opt/relay-community`, systemd, env, cookies).
This is what to do for **each new release** — not a from-scratch install.

Full layout / first-time steps: `[README.md](./README.md)`.  
Verification table: `[SMOKE.md](./SMOKE.md)`.

Keep `REDDIT_DRY_RUN=true` on the timer until you deliberately go live.

---

## A. On your laptop (before the ThinkPad)

- [x] Changes you care about are committed and pushed to the remote the ThinkPad tracks
- [x] Especially: `pnpm-lock.yaml` (now uses published `@voltmem/client` — no sibling voltmem checkout)
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

- [ ] `git pull` clean (or conflicts resolved)
- [ ] `pnpm install` + build OK (`apps/community-engager/dist/run-dev.js` fresh)
- [ ] No sibling `/…/voltmem` tree required for `@voltmem/client` anymore

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

## D. VoltMem (sidecar) — only if memory is in use

App client = npm `@voltmem/client` (pulled with `pnpm install`).  
Domains JSON = still a **sidecar** mount (not the npm package).

- [ ] Sidecar still healthy (`curl -s "$VOLTMEM_URL/health"` or run log shows `Memory: voltmem (sidecar ok)`)
- [ ] If `voltmem-domains.json` changed in the pull: restart sidecar so it reloads the mount
- [ ] `VOLTMEM_DOMAINS_FILE` still points at the community domains file

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
- [ ] Smoke or service run COMPLETE with dry-run
- [ ] Timer env still HITL-off / dry-run
- [ ] Jar intact (or re-authed once)

---

## Appendix — greenfield only

If this machine has **no** `/opt/relay-community` yet, follow `[README.md](./README.md)` §§ trees → Chromium → env → jar → systemd, then use this checklist for every later update.