# Relay Desk — how it works

A plain-language guide to what Relay Desk is for, how the three main areas fit together, and what the words on screen mean.

For install and laptop setup, see [`README.md`](./README.md) and [`LAPTOP.md`](./LAPTOP.md).  
For design tokens and copy rules, see [`DESIGN.md`](./DESIGN.md).

---

## In one sentence

**Relay Desk is where you design an automated job, prove it’s safe, turn it on, and stay available when it needs a human decision.**

---

## The big picture

You start with an **intent** (“every weekday, find new bug issues and ask me before commenting”). Desk turns that into a precise plan (a **Spec**), checks it, rehearses it without real side effects, then runs it on a schedule. When the plan needs your judgment, Desk calls you to a **seat** — a live computer screen you can watch and approve or abort.

Three places in the left sidebar:

| Place | Your job there |
|-------|----------------|
| **Build** | Invent and ship the plan (draft → checks → going live) |
| **Apps** | Manage plans that are already approved and installed |
| **Seats** | Attend live computers and answer “should we do this?” moments |

Settings (footer of the sidebar) stores connection URLs and tokens. Those stay on this Mac.

---

## A typical first journey

**ASAP dogfood path:** use the **GitHub triage** preset (repo `acme/widgets`, connection `github:default`). CE fashion / Reddit write is a demo only — not the success bar.

1. Open **Build** → **+ New spec**.  
2. Keep **GitHub triage** (or write a catalog-only intent) → **Create draft**.  
3. You land in **Design**: see the flow as a diagram; tweak the plan in YAML if you need to.  
4. Go to **Verify** → **Run checks**. Fix anything that fails (jump back to the exact YAML line).  
5. Go to **Ship**. Walk the checklist: freeze → install → connect secrets → **shadow run** (rehearsal) → approve evidence → **Enable** (schedule) and/or leave schedule off and use **Run once** later.  
6. The app appears under **Apps**. You can **Run once** on demand, and/or **Enable** so schedules fire.  
7. When a run pauses for you (including Run once HITL), **Activity** or Apps → **Open Seats** → Approve or Abort.

That’s the whole product loop: **design → prove → ship → operate → attend**.

---

## Build — invent the plan

### Library

**Build** opens a list of **in-progress** work on *this* Desk (drafts and frozen-but-not-yet-live plans). Approved live apps do **not** live here — those are under **Apps**.

### New spec

You describe what you want. Desk scaffolds a **Spec** (structured plan) against the **curated catalog** only (github, reddit, slack, …). If something’s missing, you get a **Needs** list (import descriptor / add connection) instead of invented APIs. Offline (no LLM key) still picks GitHub triage when the intent says GitHub — not a Reddit stub.

### Workspace stages

Once you have a draft, four stages answer four questions:

| Stage | Question |
|-------|----------|
| **Design** | What will it do? (flow diagram + optional YAML) |
| **Verify** | Is it correct and safe? (structure + rules checks) |
| **Ship** | Can it go live? (freeze, install, shadow, enable) |
| **Activity** | What did it do? (runs, waits, outcomes) |

Header shows **Build**, the current stage, your draft’s title, and a small **lifecycle** pill (Draft → Checks passed → Frozen → Live…). Use **Next: …** when you’re ready to move on.

---

## Ship — going live without surprises

Ship is a checklist, not a single button:

1. **Freeze** — lock this version of the plan.  
2. **Install** — put it on the Apps fleet (this Desk’s server).  
3. **Connect** — mark required secrets/connections as ready.  
4. **Shadow run** — rehearse with **simulated writes** (no real posts/comments).  
5. **Approve evidence** — you looked at what the rehearsal would have done.  
6. **Enable** — turn the schedule on. Locked until evidence is approved. Optional if you only want on-demand runs.

After the Ship gate clears, manage day-to-day life on **Apps**. To change the plan later: **Edit spec** (thaw) → back to Build Design → re-check and re-ship.

---

## Apps — the approved fleet

**Apps** is only for installed, approved plans:

- **Run once** — on-demand live run (tap again to **Confirm run**). Needs connections + approved shadow evidence; does **not** need the schedule Enabled. HITL pauses go to **Seats**.  
- **Enable / Pause / Resume / Disable** — schedule only (cron/poll ticks). Separate from Run once.  
- See recent runs  
- **Edit spec** opens Build again (re-gates: you must shadow and approve again before Run once or Enable)

**Run once vs Enable:** Run once = “do it now.” Enable = “keep doing it on the trigger.” Manual Specs with no schedule still use Run once after the Ship gate.

Creating and editing the *shape* of the plan stays in Build. Apps is operations. Build YAML **live** run stays forbidden — live happens from Apps after the gate.

---

## Seats — when a human must decide

Some steps need you: “Approve this draft comment before posting.” That’s **HITL** (human in the loop).

- Pending decisions show on **Seats**.  
- **Watch** opens a live desktop stream without taking exclusive control.  
- **Open seat / Acquire** claims a computer so you can drive if needed.  
- **Approve** / **Abort** answers the pending request.

**Activity** on a draft deep-links here when a run is waiting for you. Seats are a **shared pool** any app can use — not “your personal computer” (that’s a future **My Desk** idea, not in the sidebar yet).

---

## What has to be running

Desk is a **client**. Depending on what you’re doing:

| Need | Typical local URL | Role |
|------|-------------------|------|
| **Computer gateway** | `http://127.0.0.1:9000` | Pool of desktop seats + VNC streams |
| **Spec API** (shell) | `http://127.0.0.1:8790` | Scaffold, validate, freeze, shadow, apps |
| **HITL bridge** | `http://127.0.0.1:9100` | Pending approve/abort cards |

Use the **Relay Desk app window** (Tauri) for gateway Probe — a plain browser tab can hit CORS and show “Failed to fetch” even when the gateway is fine.

---

## Glossary (words you’ll see)

| Term | Plain meaning |
|------|----------------|
| **Intent** | What you want, in everyday language |
| **Spec** | The precise plan Desk generated from your intent |
| **Draft** | A Spec you’re still working on (saved on this Desk) |
| **YAML** | The editable text form of the Spec (source of truth) |
| **Schematic** | The flowchart view of triggers and steps |
| **Trigger** | What starts a run (schedule, poll, or manual) |
| **Step** | One action in the plan (scout, draft, approve, post…) |
| **forEach** | “Do this step once per item in a list” |
| **HITL / human.approve** | A step that waits for your Approve or Abort |
| **Irreversible** | A step that can’t be undone (e.g. posting a comment) |
| **Rule** | A guardrail (hard = must pass; soft = quality judge; outcome = later metric) |
| **Scaffold** | Generate a first Spec from intent |
| **Validate / checks** | Machine checks that the Spec is well-formed and safe enough |
| **Evals** | Extra test cases derived from your rules |
| **Freeze** | Lock this Spec version so it can be shipped |
| **Bundle / Relay App** | Packaged Spec + metadata you install onto Apps |
| **Shadow run** | Rehearsal: same logic, writes are simulated |
| **Evidence** | Record of what the shadow run would have done |
| **Simulated writes** | Fake side effects shown for review (not sent to the real API) |
| **Enable** | Turn the schedule on so the app can run by itself |
| **Run once** | On-demand live run from Apps (after shadow gate; HITL → Seats) |
| **Pause / Resume** | Hold or restart a live schedule |
| **Thaw / Edit spec** | Unlock an installed app for editing (must re-verify and re-shadow) |
| **Run** | One execution of the plan |
| **Fanout** | Running the same step for many items (e.g. two posts → two drafts) |
| **Seat** | One pooled virtual desktop you can watch or claim |
| **Watch** | See the desktop stream without claiming it |
| **Lease / Acquire** | Exclusive claim on a seat (with heartbeat) |
| **Park** | Soft-release: leave the desktop warm for later |
| **Recycle** | Wipe and free a worker |
| **Gateway** | Service that owns the seat pool (`COMPUTER_GATEWAY_URL`) |
| **Spec API** | Service that runs Build/Ship/Apps backends |
| **Lifecycle pill** | Short status on the draft: Draft, Frozen, Live, Paused… |

Internal IDs (`specHash`, bundle ids, capability names like `api.request`) may appear in small mono text — they’re for debugging, not the main story.

---

## What Relay Desk is *not*

- Not a general coding IDE  
- Not where you permanently store drafts on a shared server (v1 drafts live on **this Desk**)  
- Not “My Desk” (personal always-on computer) — reserved name, not shipped yet  
- Not the place to invent Specs from the **Apps** list (use **Edit spec** → Build)

---

## If something feels stuck

| Symptom | Likely meaning |
|---------|----------------|
| Shadow soft-rule / draft failures offline | Stub LLM rehearsing quality rules — Desk fixtures should pass after a shell restart |
| Shadow hangs on “Fanout approve” | HITL inside a multi-item step; rebuild `@relay/runtime` (and any touched packages), then restart Spec API so **dist** matches source |
| Gateway Probe = “Failed to fetch” | Browser CORS — use the Tauri Desk window, or Vite proxy with local `127.0.0.1:9000` |
| Enable / Run once greyed out | Shadow evidence not approved yet (or connections incomplete / thawed) |
| Run once pauses (incl. per-item approve) | Expected — open **Seats**; Approve may pause again on the next fanout item |
| Run once used to skip HITL (`approve → unknown`) | Fixed in runtime — rebuild `@relay/runtime` and restart Spec API |
| Edit spec on Apps | Expected — you’re sent to Build to re-gate |

After changing runtime / engines packages locally: `pnpm --filter @relay/runtime build` (plus other touched packages), then restart the Spec API process so Desk uses the new dist.

---

## Related

- Product UX plan: [`.cursor/plans/desk_spec_workspace_ux.plan.md`](../../.cursor/plans/desk_spec_workspace_ux.plan.md)  
- Intent → Spec thesis: [`.cursor/plans/relay_intent_spec_verify_hitl.plan.md`](../../.cursor/plans/relay_intent_spec_verify_hitl.plan.md)  
- My Desk (backlog): [`.cursor/plans/desk_my_desk.plan.md`](../../.cursor/plans/desk_my_desk.plan.md)  
