# Relay OS

**Relay** is software for running **agentic apps** — programs that do work on your behalf, pause to ask you when a decision matters, then continue.

Think of it less like a flowchart of automations, and more like hiring an assistant who must **check with you** before sending the email, posting the comment, or moving the money.

---

## In one sentence

**n8n** wires systems together and can optionally ask a human before a step.  
**Loops** run an agent in a disciplined cycle until gates pass.  
**Relay** runs an agent that negotiates with a human through a protocol, then acts.

---

## Relay vs n8n vs Loops (plain English)

### What n8n is good at

[n8n](https://n8n.io) is a **workflow automation** tool. You connect apps (Gmail, Slack, APIs, databases) on a canvas. Data flows from node to node. When something needs a person, you can add a pause — for example “approve this before the next step runs.”

That’s powerful for ops: *if X happens, do Y, maybe ask me first.*

### What Loops are good at

**Loops** (agent-loop / gate style — e.g. [loops](https://github.com/jonny981/loops)) keep an agent working in a **disciplined cycle**: do the work → check gates (tests, judges, reviewers) → retry until those gates pass. A human can be one gate among many. The process is exact; creativity stays inside each step.

That’s powerful for long unattended runs: *keep going until it’s actually done and safe.*

### What Relay is for

Relay is built around **agents** that follow a staged plan and a shared **feedback protocol**:

| Idea | What it means for you |
|------|------------------------|
| **Agentic app** | A packaged assistant with a job (e.g. “scout Reddit and draft replies”), not a one-off flowchart |
| **Stages** | Clear steps: find work → draft → wait for you → publish → learn |
| **Feedback types** | Not only yes/no — you can **approve**, **edit the draft**, **pick an option**, **enter a code**, or **abort** |
| **Negotiate, then act** | The agent presents a proposal; you shape it; only then does it take the risky action |
| **Memory (VoltMem)** | It can remember what you rejected or preferred last time, so the next draft is smarter |

### A concrete example

**Job:** Suggest community replies for your product, but never post without you.

| In n8n | In Loops | In Relay |
|--------|----------|----------|
| Workflow: find thread → AI draft → Wait/Telegram approve → post | Cycle: draft → gates (quality/policy) → retry until gates pass → maybe human veto | Run a **Community** agent that speaks Relay’s feedback language |
| Approve/deny is usually “run this next node or don’t” | Human is often one gate; the loop owns *until done* | You get a **draft to edit**, intensity to confirm, and **abort** as a first-class outcome |
| The workflow *is* the product | The **process / loop** is the product | The **protocol + runtime** is the product; the community agent is one app on top |

Same end result is possible in more than one of these. The difference is the **center of gravity**:

- **n8n** → “Wire systems; optionally ask a human before this node.”
- **Loops** → “Run an agent in a disciplined cycle until gates pass.”
- **Relay** → “Run an agent that negotiates with a human through a protocol, then acts.”

If you only need one Reddit bot next week, n8n (or a small custom script) may be enough.  
If you need long runs that only stop when tests/judges/people clear gates, that’s Loops territory.  
If you want many agentic apps that all share the same approve / edit / abort / credential patterns — and later a full agent workspace — that’s Relay.

---

## The product: living todo + HITL + runtime

Relay is the **whole flow**, not just infrastructure and not just an approval widget.

```text
┌─────────────────────────────────────────┐
│  Living todo UX                         │  ← what you open daily
│  Add a job + priority → queue runs it   │
│  (priority first, then chronological)   │
├─────────────────────────────────────────┤
│  Feedback surface (gotoHuman-style)     │  ← how negotiation feels
│  Card / Telegram: approve, edit, abort  │
├─────────────────────────────────────────┤
│  Relay protocol + runtime               │  ← stages, WAITING_USER,
│  + VoltMem + engines + agentic apps     │     manifests, memory
└─────────────────────────────────────────┘
```

| Layer | Job |
|-------|-----|
| **Living todo** | Priority queue of **agent jobs** (not grocery checklists). Each item can become a plan → manifest → running agent. |
| **Feedback surface** | When the agent needs you, the **todo card** (and/or Telegram) is the negotiation UI — same idea as [gotoHuman](https://www.gotohuman.com/)-style review, but owned by Relay’s feedback types. |
| **Runtime** | Manifest stages, Feedback Broker, engines, VoltMem — so many apps share one approve / edit / abort language. |

**Living todo (plain English):** you add an item with a priority tag; Relay orchestrates a plan into a manifest and runs jobs in priority order (then by age). Mid-flight it pauses that card and asks you when a human decision is required, then continues or aborts.

One more center-of-gravity line:

- **Living todo** → “A priority queue of agent jobs; each job plans a manifest, runs stages, and pauses the card when a human must decide.”

We’re **not** competing as another AI Todoist. We’re **not** only an approval inbox others plug into. The queue is the shell; the review UI is how HITL feels; the protocol is why it’s a product.

---

## What we’re building first

We’re **not** starting with a fake desktop OS. The shell is the **living todo / agent queue**.

We’re proving the full stack end-to-end:

1. Add a job (priority + chrono queue)  
2. Run a known agentic app (manifest stages)  
3. Pause for human feedback on the card (and/or Telegram / CLI)  
4. Act only after approval (or stop on abort)  
5. Remember outcomes via [VoltMem](https://github.com/Rouche01/voltmem)  

First dogfood app: **CommunityEngager** (GoStylens community HITL).

**Plans:**

- Living todo shell (queue UX + in-card HITL): [`.cursor/plans/relay_living_todo_shell.plan.md`](.cursor/plans/relay_living_todo_shell.plan.md)
- Community HITL runtime + VoltMem: [`.cursor/plans/relay_hitl_community_voltmem.plan.md`](.cursor/plans/relay_hitl_community_voltmem.plan.md)

Architecture (technical): [`ARCHITECTURE.md`](ARCHITECTURE.md)

---

## Repo layout (today)

```text
relay-os/
├── apps/
│   ├── community-engager/     # first dogfood agentic app
│   └── newsletter-migrator/   # early example (parked)
├── packages/
│   ├── protocol/              # manifests, feedback types, events
│   ├── runtime/               # runs stages, waits for feedback
│   ├── feedback-broker/       # routes feedback ↔ adapters
│   ├── adapters-telegram/     # HITL over Telegram
│   ├── action-store/          # draft / job status persistence
│   ├── context-engine/        # VoltMem memory
│   ├── llm-controller/        # LLM routing for agents
│   └── engines-browser/       # browser automation engine
├── ARCHITECTURE.md
└── README.md                  # you are here
```

Living todo / agent-queue UI is the next product shell (see plan) — not in tree yet.

---

## Status

Protocol, runtime, CommunityEngager HITL path, Telegram adapter, and VoltMem context engine are in progress or scaffolded. Next product surface: **living todo queue** on top of that stack.
