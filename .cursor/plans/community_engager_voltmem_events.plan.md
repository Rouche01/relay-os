---
name: Community Engager VoltMem events vs beliefs
overview: "Stop false-merging CommunityEngager memories by splitting VoltMem usage: episodic HITL/discover writes via addEvent (unconditional), durable preferences via remember/addFact with distinctive text. Extend context-engine; keep search/drafter injection working."
todos:
  - id: ce-add-event-api
    content: packages/context-engine — addEvent (and optional getEvent) on ContextEngine + VoltMemEngine; fail-open; return WriteResult action when useful
    status: completed
  - id: memory-phrasing
    content: apps/community-engager memory.ts — distinctive fact strings (ids first); outcomes include draftId + threadUrl; promote/rules lead with r/{sub}; shorten shared discovery boilerplate
    status: completed
  - id: wire-episodic-writes
    content: controller + discover — HITL outcomes (and optionally promote) use addEvent with stable event_id; discovery proposals either event-per-sub or drop bulk remember; keep voice/durable prefs on addFact
    status: pending
  - id: run-evidence-action
    content: run-evidence MemoryWriteEvidence — record voltmem action (inserted|confirmed|…) + eventId when present; surface in job-queue / run log
    status: pending
  - id: dogfood-verify
    content: Clear or use fresh tenant slice; two runs on different subs/drafts; confirm new active rows (not only last_confirmed_at bumps); drafter still gets memory block
    status: pending
isProject: true
---

# Community Engager — VoltMem events vs beliefs

Companion to [`relay_hitl_community_voltmem.plan.md`](./relay_hitl_community_voltmem.plan.md) (p2 memory write/read is done but **misuses** `remember` for episodic facts).

## Problem

Dogfood showed ~4 active VoltMem rows while runs “successfully” wrote outcomes/promotes. Sidecar `POST …/memories` → `remember()`: high similarity (≥ ~0.82) → **confirm** existing row (`last_confirmed_at` bump) instead of insert. Our templates (`Human approved … intensity=0; subreddit=r/…`) only swap the sub name → **false merges** across drafts/subs. Run log `memory.ok: true` is correct; row count is not.

VoltMem is designed for **beliefs that update**. CommunityEngager mostly needs **events that accumulate**.

## Target model

```text
┌──────────────────────────────────────────────────────────┐
│  Episodic (must not false-merge)                         │
│  HITL approve/edit/abort per draft                       │
│  Allowlist promote (optional as event)                   │
│  API: client.addEvent(event_id, facets) → unconditional  │
│  event_id e.g. draft:{id}:{outcome} | promote:{sub}      │
└──────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│  Durable beliefs (confirm/merge OK / desired)            │
│  Voice constraints, lasting preference summaries         │
│  API: client.add / ContextEngine.addFact → remember()    │
│  Phrasing: discriminating tokens first (r/{sub}, ids)    │
└──────────────────────────────────────────────────────────┘
```

Search / `rememberForPrompt` stays domain-scoped; events remain searchable as normal memories linked by `event_id`.

## Non-goals

- Changing VoltMem confirm thresholds as the primary fix (optional later: `VOLTMEM_VERIFY_ON_WRITE`)
- Reworking allowlist file store (still source of truth for postable subs)
- Living-todo shell ([`relay_living_todo_shell.plan.md`](./relay_living_todo_shell.plan.md))

## Implementation

### 1. `packages/context-engine`

- Extend `ContextEngine` with something like:

```ts
addEvent(
  eventId: string,
  facets: Array<{ content: string; domain?: string }>,
  options?: { source?: string; tenantId?: string }
): Promise<WriteResult[] | null>; // null / [] fail-open
```

- `VoltMemEngine`: call `@voltmem/client` `addEvent` (already exists).
- Prefer returning `WriteResult.action` so apps can log `inserted` vs surprises.
- Keep `addFact` for beliefs; do not change fail-open contract.

### 2. `apps/community-engager` fact phrasing (`memory.ts`)

Even for events (readable recall) and remaining `addFact` paths:

| Kind | Lead with | Avoid |
|------|-----------|--------|
| Outcome | `draft={id}`, `r/{sub}`, URL/title snippet | Shared-only “Human approved community draft at intensity=N” |
| Promote / rules | `r/{sub}` first | Identical long discovery notes across candidates |
| Discovery propose | `r/{sub}` first; prefer **one event per sub** or skip bulk write | 5 near-identical preference remembers per run |

### 3. Wire writes

| Call site | Today | Target |
|-----------|--------|--------|
| `writeHitlMemory` (approve/edit/abort) | `addFact` / data `add_fact` | `addEvent("draft:{id}:{outcome}", [{ content, domain: community_outcome }])` |
| `applyDiscoverFeedback` promote | two `addFact`s | preference: `addFact` **or** `addEvent("promote:{sub}", …)`; rules: same event second facet **or** `addFact` with distinctive text |
| `discover.ts` per candidate | `addFact` preference | `addEvent("discover:{sub}:{runId?}", …)` **or** stop persisting every proposal (promote-only is enough for dogfood) |
| Voice / future durable prefs | — | stay on `addFact` |

Stable `event_id` → re-running the same decision is idempotent for that event, not a merge with another draft.

### 4. Run evidence

Extend `MemoryWriteEvidence`:

- `eventId?: string`
- `action?: string` (from VoltMem `WriteResult`)

Populate from controller; show in `formatRunSummary` / run log schema (bump if needed).

### 5. Verify

1. List memories before/after on `relay-local` (or a scratch tenant).
2. Approve two different drafts on different subs → **two** active outcome rows (or two event ids via `GET …/events/{id}`).
3. Promote a new sub → new preference/rules (or promote event), not only `last_confirmed_at` on an old FashionOver50 row.
4. Drafter still receives a non-empty memory block when facts exist.

## Files (likely)

- `packages/context-engine/src/types.ts`
- `packages/context-engine/src/voltmem-engine.ts`
- `packages/context-engine/src/null-engine.ts`
- `apps/community-engager/src/memory.ts`
- `apps/community-engager/src/controller.ts` (`writeHitlMemory`, promote)
- `apps/community-engager/src/discover.ts`
- `apps/community-engager/src/engines.ts` (data engine: `add_event` action if learn path uses engine)
- `apps/community-engager/src/run-evidence.ts` (+ job-queue formatting)

## Success criteria

- Distinct drafts/subs produce distinct active memories (or distinct events), not silent confirms of unrelated rows.
- Run log shows `action` / `eventId` for outcome writes.
- Fail-open preserved; dry-run dogfood unchanged except memory semantics.
- No requirement to enable VoltMem verify-on-write for correctness.
