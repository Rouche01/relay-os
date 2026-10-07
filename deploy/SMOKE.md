# Relay CommunityEngager — smoke checklist

Run after deploy slice changes (browser + Chromium + cookies). Keep `REDDIT_DRY_RUN=true` until the gated live row.

## Local (laptop)

| # | Check | Pass criteria |
|---|--------|----------------|
| L1 | `pnpm -r typecheck` + `pnpm --filter @relay/apps-community-engager build` | Clean |
| L2 | `pnpm --filter @relay/apps-community-engager e2e` | All scenarios PASS (fixtures + job isolation) |
| L3 | Chromium installed | `pnpm --filter @relay/engines-browser exec playwright install chromium` |
| L4 | `SCOUT_SOURCE=browser` + `REDDIT_DRY_RUN=true` + CLI/Telegram | ≥1 actionable draft **or** clean interstitial detect (seconds, not minutes) + fail-open |
| L5 | Approve a draft | Execute log shows dry-run / would-post (browser intent) |
| L6 | (Optional) `REDDIT_INTERSTITIAL_HITL=true` when walled | Headed window + Approve saves jar under `REDDIT_COOKIE_DIR` |

```bash
# From repo root
pnpm -r typecheck
pnpm --filter @relay/apps-community-engager... build
pnpm --filter @relay/apps-community-engager e2e

# Interactive local dogfood
cd apps/community-engager
# ensure .env: SCOUT_SOURCE=browser REDDIT_DRY_RUN=true FEEDBACK_ADAPTER=cli|telegram
pnpm start
```

## ThinkPad (`community.env`)

| # | Check | Pass criteria |
|---|--------|----------------|
| T1 | Trees + perms | `/opt/relay-community/data/cookies/reddit` exists, mode ≥700 on cookies dir |
| T2 | Chromium + deps | `playwright install chromium` + `install-deps` done as service user |
| T3 | Manual one-shot | `node dist/run-dev.js` with sourced `community.env` → Telegram HITL |
| T4 | Cookie jar writable | After `REDDIT_ENSURE_SESSION` or interstitial Approve, `*.storage.json` appears |
| T5 | Timer dry-run | `systemctl start relay-community.service` → journal shows scout + draft; `REDDIT_DRY_RUN=true` |
| T6 | Unattended interstitial | Headless timer does **not** hang; blocked subs logged; run continues |
| T6b | Decide overnight-safe | `DECIDE_BACKEND=heuristic` (or unset); no `JEV_API_KEY` required; journal shows `decide=heuristic` / no Jev hard-fail |
| T7 | Gated live (manual) | Flip `REDDIT_DRY_RUN=false` once, Approve one comment; job file idempotent on retry |

```bash
# On host
cd /opt/relay-community/app/apps/community-engager
set -a && source /opt/relay-community/env/community.env && set +a
node dist/run-dev.js
ls -la /opt/relay-community/data/cookies/reddit/
sudo systemctl start relay-community.service
journalctl -u relay-community.service -n 100 --no-pager
```

## Safety gates

- [ ] `REDDIT_DRY_RUN=true` until T7
- [ ] Telegram allowlist user only
- [ ] No CAPTCHA solver services configured (none exist in code — keep it that way)
- [ ] Timer env does not set `REDDIT_INTERSTITIAL_HITL=true`
- [ ] Timer keeps `DECIDE_BACKEND=heuristic` unless intentionally dogfooding Jev
