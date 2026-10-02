---
name: Relay Reddit browser / scrape transport
overview: Unblock CommunityEngager from Reddit API app approval via HITL-style Playwright — structured extract for scout, LLM/vision escape hatch for login+comment; cookies for write; JSON optional; keep Telegram HITL and DRY_RUN.
todos:
  - id: p1-browser-scout
    content: Playwright scout — allowlisted r/{sub}/new via structured extract (a11y / page.evaluate / semantic locators), not brittle CSS; map → RedditListingPost; fixtures fallback
    status: completed
  - id: p1-env-config
    content: Extend reddit/config + .env.example — REDDIT_TRANSPORT, SCOUT_SOURCE=browser|oauth|json|fixtures|auto, cookie dir, username/password without OAuth client id; depend on @relay/engines-browser
    status: completed
  - id: p2-cookie-store
    content: Port HITL cookie save/load/delete pattern — .data/cookies/reddit/; wire Playwright storageState or setCookie
    status: completed
  - id: p2-browser-login
    content: Login via Playwright; prefer LLMController/semantic locators; vision agent (Stagehand/Browser Use/etc.) only if auth wall fails; Telegram pause for 2FA; persist jar
    status: completed
  - id: p3-browser-execute
    content: Executor transport=browser — comment via structured/semantic first, vision escape hatch if composer flaky; DRY_RUN + Approve + idempotent jobs
    status: pending
  - id: p3-oauth-optional
    content: Keep RedditClient OAuth as optional fast path when REDDIT_CLIENT_* present; auto prefers browser (HITL path) then OAuth then fixtures
    status: pending
  - id: p4-json-scout-optional
    content: Optional only — public *.json scout if browser blocked/unavailable; never the primary dogfood path
    status: pending
  - id: p4-deploy-slice
    content: Update ThinkPad deploy — include engines-browser + Chromium deps from Phase 1; cookie dir under /opt/relay-community/data; document re-auth
    status: pending
  - id: p5-smoke
    content: Local + ThinkPad smoke — browser scout live threads; dry-run browser execute after Approve; then gated live comment
    status: pending
isProject: true
---

# Relay OS — Reddit browser / scrape transport

Canonical plan for **unblocking CommunityEngager** while Reddit API app creation is pending. Sibling of [`relay_hitl_community_voltmem.plan.md`](./relay_hitl_community_voltmem.plan.md) (HITL runtime) and [`relay_thinkpad_deploy.plan.md`](./relay_thinkpad_deploy.plan.md) (host layout).

**Pattern source:** `~/Projects/hitl-human-in-the-loop` — PuppeteerBot + stealth, cookie jar on disk, AUTH vs AUTHED flows, stage sequences. Relay already has `@relay/engines-browser` (Playwright + stealth); CommunityEngager still depends on OAuth `RedditClient`.

**Primary path:** interactive Playwright (same idea as HITL), not public `*.json` fetch. JSON is optional fallback only.

**Engine strategy:** hybrid — structured/semantic extract for scout; LLM (existing `LLMController`) then optional vision agents for fragile auth/comment. Full VLM-every-step is not the default.

## Why

- Reddit app registration has not responded → OAuth password grant never configures → scout stays on fixtures.
- HITL already proved: stealth browser + extraction + persisted cookies + human pause for hard auth steps.
- Hard product rule unchanged: **nothing posts without human Approve** (Edit allowed; Abort first-class). `REDDIT_DRY_RUN=true` until intentional live.

## Non-goals

- Porting Socket.IO / Redis / child-process mesh from HITL (Feedback Broker + Telegram already cover HITL).
- Generic Substack/Mailchimp stage DSL — Reddit needs focused flows only (`scout-list`, `login`, `comment`).
- Making `*.json` the dogfood path (authentic, but not interactive scraping).
- Vision/VLM as the primary scout loop (cost, latency, non-determinism on structured fields).
- Captcha vendor unless login actually requires it.
- Living-todo UI or Newsletter Migrator work.

## Engine strategy (hybrid)

Goal: less flaky than HITL-era CSS soups, without paying a vision model on every overnight listing.

| Layer | When | How |
|-------|------|-----|
| **Structured extract** | Scout `/new` listings (default) | Playwright + a11y tree, `page.evaluate`, or semantic locators → stable `RedditListingPost` (id, title, permalink, …) |
| **LLM + semantic** | Login / reply composer when layout shifts | Existing `LLMController` + `PlaywrightEngine` snapshot (text) → `role`/`name`/`text` actions — already in-repo |
| **Vision agent escape hatch** | Auth wall, CAPTCHA UX, composer unfindable via a11y | Swap/`engines-browser` backend later (Stagehand, Browser Use, Skyvern, etc.) behind the same `ExecutionEngine` interface — do **not** hard-wire a vendor in Phase 1 |
| **JSON** | Browser unavailable / blocked | Optional Phase 4 only |

**Rules of thumb**

1. Scout must produce **deterministic-ish** fields for scoring and job ids — prefer extract over “model guessed the title.”
2. Vision/LLM is for **navigation and fragile UI**, not for inventing post metadata when the DOM already has it.
3. Keep `@relay/engines-browser` as the seam so a vision backend can plug in without rewriting CommunityEngager stages.
4. Overnight ThinkPad economics: listing loop stays cheap; burn tokens only on login/comment failure paths.

```text
scout:   Playwright → structured extract → score → draft
login:   Playwright → LLM/semantic → (fail) → vision agent → cookies
comment: Playwright → LLM/semantic → (fail) → vision agent → permalink
```

## Current state

| Piece | Today |
|-------|--------|
| Scout | OAuth `listNew` or fixtures (`SCOUT_SOURCE=auto`) |
| Execute | OAuth `api/comment` or dry-run log |
| Browser engine | Exists; **not** wired to CommunityEngager |
| ThinkPad slice | Explicitly **excludes** `engines-browser` — **must change in Phase 1** |

## Target architecture

```text
                    ┌─ Scout (read) ──────────────────────────┐
                    │  1) Playwright r/{sub}/new (HITL-style) │
                    │  2) OAuth listNew if app eventually OK  │
                    │  3) Optional *.json if browser fails    │
                    │  else fixtures                          │
                    └────────────────┬────────────────────────┘
                                     ▼
                          score ≥4 · allowlist · draft
                                     ▼
                          Telegram HITL (unchanged)
                                     ▼
                    ┌─ Execute (write) ───────────────────────┐
                    │  cookies? → Playwright comment on URL   │
                    │  else → login → save jar → comment      │
                    │  OAuth comment if client configured     │
                    │  REDDIT_DRY_RUN default true            │
                    └─────────────────────────────────────────┘
```

### Config sketch

```bash
# Primary transport = browser (HITL interactive scrape)
# auto | browser | oauth | json | fixtures
REDDIT_TRANSPORT=browser
SCOUT_SOURCE=auto   # browser | oauth | json | fixtures | auto

REDDIT_USERNAME=
REDDIT_PASSWORD=
# OAuth optional — used when present
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USER_AGENT="relay-community-engager/0.1 by u/YOUR_USERNAME"
REDDIT_DRY_RUN=true

# Cookie jar (default under app .data)
REDDIT_COOKIE_DIR=.data/cookies/reddit
# Headless for servers; headed helpful for first login
REDDIT_BROWSER_HEADLESS=true
```

**`auto` resolution (proposed):**

| Step | Scout | Execute |
|------|--------|---------|
| 1 | Playwright listing (allowlisted subs) | Browser if cookies or user/pass |
| 2 | OAuth if `CLIENT_*` configured | OAuth if configured |
| 3 | Optional JSON | dry-run / refuse |
| 4 | fixtures | — |

## Phase 1 — Playwright interactive scout (primary)

**Exit:** Live allowlisted threads scored and drafted via **structured browser extract** — no Reddit API app required. Interactive browser session (HITL idea), not brittle CSS-selector stage scripts and not VLM-every-card.

1. Depend on `@relay/engines-browser` from `apps/community-engager`.
2. Add `reddit/scout-browser.ts`:
   - Launch Playwright + stealth (reuse `PlaywrightEngine` or thin Reddit driver on Playwright)
   - For each allowlisted sub: `goto` `https://www.reddit.com/r/{sub}/new/` (old.reddit now forces login anonymously)
   - **Structured extract** → `RedditListingPost` via `shreddit-post` attributes (`id`, `post-title`, `permalink`, …) — not CSS soup; optional LLMController only if extract returns empty
   - Modest delay between subs; teardown browser when done
3. Isolate extract helpers in one module (not a giant selector table).
4. Wire `scoutOpportunities` + `getRedditEnv` for `browser` / `auto` **without** requiring `CLIENT_ID`.
5. Keep score gate ≥4, allowlist, fixture fallback on empty/error.
6. Update `.env.example`; note Chromium needed for scout (not only write).

**Scout may be anonymous** (public `/new` pages). Cookies optional for Phase 1; login jar lands in Phase 2 for write (and for scout if Reddit walls anonymous browse).

**Risk mitigation:** low QPS; stealth; fail-open to fixtures; clear error if extract shape breaks; do not burn vision tokens on listing.

## Phase 2 — Cookie jar + login (HITL pattern)

Port from HITL `services/bot-service/utils.ts`:

| HITL | Relay |
|------|--------|
| `cookies/{integration}/user-{id}-{account}.json` | `.data/cookies/reddit/{account}.json` (or Playwright `storageState`) |
| `saveSessionCookies` / `retrieve` / `delete` | same helpers under `apps/community-engager/src/reddit/cookies.ts` |
| AUTH clears old jar; AUTHED injects | login refreshes; execute (and optionally scout) loads |

Login flow:

1. Navigate Reddit login (Playwright + stealth)
2. Fill username/password — semantic locators / LLMController first
3. If challenge / CAPTCHA / unknown UI → vision-agent escape hatch **or** FeedbackRequest (Telegram) pause for human
4. On success → persist cookies / storageState
5. Teardown browser

Prefer **storageState** if it maps cleanly to Playwright; keep JSON cookie export for HITL-style debugging.

## Phase 3 — Browser execute

Extend `executeApproved`:

1. Unchanged gates: status, intensity-2 disclosure, idempotent job file, UTM rewrite, `REDDIT_DRY_RUN`
2. If dry-run → log intended URL + text (include `transport=browser`)
3. If live + browser transport:
   - Load cookie jar (else run login)
   - `goto` `draft.threadUrl`
   - Open reply composer (semantic / LLMController); vision escape hatch if composer not found
   - Fill `draftText`, submit; read comment permalink → job result
4. Keep OAuth path when transport/oauth credentials say so

`redditThingId` remains useful for scoring/idempotency; browser path keys off `threadUrl` primarily.

## Phase 4 — Optional JSON + deploy

1. **Optional only:** `scout-json.ts` (`old.reddit.com/…/new.json`) if Playwright is unavailable or repeatedly blocked — not the primary path.
2. Update [`relay_thinkpad_deploy.plan.md`](./relay_thinkpad_deploy.plan.md) / runbook:
   - Add `packages/engines-browser` to workspace slice (**required from Phase 1**, not deferred)
   - Install Chromium deps on host
   - Cookie dir under `/opt/relay-community/data/cookies/reddit`
   - Document “re-auth when jar expires” (Telegram alert or failed execute → human)
3. systemd timer unchanged; only login needs a human

## Phase 5 — Smoke

| Check | Pass |
|-------|------|
| Local `SCOUT_SOURCE=browser` | ≥1 actionable draft from allowlist via Playwright |
| E2E HITL approve | dry-run execute log shows browser intent |
| ThinkPad | same with `community.env`; Chromium + cookies writable |
| Live (manual flip) | one Approve → real comment; job idempotent on retry |

## File touch map (expected)

```text
apps/community-engager/
  src/reddit/
    scout-browser.ts       # new — Phase 1 primary (structured extract)
    extract-listing.ts     # new — a11y / evaluate helpers (not CSS soup)
    cookies.ts             # new (HITL port)
    browser-login.ts       # new — semantic/LLM first
    browser-comment.ts     # new — semantic/LLM first; vision hook later
    scout-json.ts          # optional Phase 4
    scout-live.ts          # keep OAuth path
    client.ts              # keep; optional
    config.ts              # transport + cookie dir + headless
  src/scout.ts             # source routing (browser first)
  src/executor.ts          # browser branch
  package.json             # @relay/engines-browser (+ optional llm-controller)
  .env.example
packages/engines-browser/  # storageState; keep ExecutionEngine seam for vision backends
packages/llm-controller/   # reuse for login/comment when needed
.cursor/plans/
  relay_thinkpad_deploy.plan.md   # engines-browser required for scout+write
  relay_hitl_community_voltmem.plan.md  # link this plan
```

## Risks

| Risk | Mitigation |
|------|------------|
| ToS / anti-bot | Allowlist only; low rate; HITL always; dry-run default |
| Headless detection | Existing stealth plugin; headed for first login if needed |
| Cookie expiry | Detect auth wall on execute → FeedbackRequest re-login |
| UI churn | Structured extract + semantic/LLM; vision only as escape hatch |
| Vision cost/nondeterminism | Never use VLM as default scout; validate extracted ids/permalinks |
| Deploy size | Chromium required once browser scout is primary (accept cost) |
| Anonymous browse wall | Reuse login cookies from Phase 2 for scout too |

## Relationship to other plans

| Plan | Role |
|------|------|
| `relay_hitl_community_voltmem` | Runtime dogfood; this plan replaces/augments Reddit **API** assumption |
| `relay_thinkpad_deploy` | Host layout; amend slice when Phase 1 lands (browser needed early) |
| `relay_living_todo_shell` | Unchanged consumer of CommunityEngager |

## Build order

1. ~~OAuth scout/execute~~ (already done; blocked on app)
2. **Playwright interactive scout + env** ← start here
3. Cookie store + login
4. Browser execute (dry-run then live)
5. Optional JSON fallback + deploy notes
6. Smoke
