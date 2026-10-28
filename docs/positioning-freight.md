# Relay — positioning, vertical and differentiation

Snapshot of the 2026-10-28 positioning discussion. Companion to [`viability.md`](./viability.md) (viability by layer) and the build plan "Generated HITL workflows (CE rebuild as first test)". Rewrite as customer discovery changes the picture.

**Decision:** lean into **freight and logistics operations** as the first vertical. Keep building the generic layer (Spec v2, validator, generic interpreter, evals) underneath; sell the vertical first.

---

## Is there a need?

Yes. Companies want agents to do real work but do not trust them with irreversible actions. Approval before high-impact actions is now a formal security control (e.g. [OWASP AISVS — high-impact action approval](https://github.com/OWASP/AISVS/blob/main/research/chapters/C09-Orchestration-and-Agents/C09-02-High-Impact-Action-Approval.md), which cites 79% of enterprises reporting blindspots in what agents invoke or change).

The catch: "describe a job, get an agent that asks before it acts" is crowded in 2026. Approval before irreversible actions is table stakes, not a differentiator.

---

## Competitor landscape (October 2026)

### Prompt-to-agent builders with approvals

- [AgentWorks](https://agent-works.ai/ai-agents) — interview, then a plan where every action is "automatic" or "asks for approval"; 66 templates. Closest to Relay's Spec-freeze idea, as a polished no-code product.
- [Rerun](https://www.neurokitai.com/en/products/rerun) — describe a task, watch runs live, approve sensitive actions (launched July 2026).
- [Appngen](https://appngen.com/) — trust ladder (watch, draft, approve, spot-check, autonomous); closest to Relay's improvement loop.
- Lindy, Gumloop, Zapier, n8n — per-action "require approval" toggles on tools.
- Vertical builders: [Talkdesk Agent Builder](https://www.talkdesk.com/news-and-press/press-releases/agent-builder/) (validates CX agents before deploy), [Port AI Builder](https://www.port.io/news/port-ai-builder-announcement) (software delivery).

### Governance and policy-gate infrastructure

- [Microsoft Agent Governance Toolkit](https://microsoft.github.io/agent-governance-toolkit/adr/0030-action-bound-approval-protocol/) — open source; action-bound, fail-closed approval with allow / deny / require-approval, revalidated before execution. Nearly Relay's HITL + evidence design, free.
- [Lodestar](https://qmilab.com/lodestar/docs/concepts/policy-kernel/), [Kernel](https://onkernel.ai/), [Sentinel](https://sentinelsca.com/) — commercial policy gates for agent actions.

---

## What is not commoditized yet

- **Rules derived from the goal, checked at three times.** Competitors gate actions ("this tool needs approval"). Relay derives checkable rules from the goal and checks them when the Spec is written, on every output at run time, and against outcomes afterwards.
- **Human decisions improve the rules.** Approve / Edit / Abort decisions tighten rules and calibrate judges over time.
- **Computer-use fallback under the same Spec.** Builders stop where integrations stop; Relay can drive GUI-only systems under the same rules.
- **Formal verification (long term).** From the research-lab thread `spec-owned-vericoding`: a provably correct safety core and, later, Specs proved against their rules.

Buyers do not buy "Spec". They buy fewer costly mistakes and safe automation of work they pay people to do. Spec, validator and evals are how Relay delivers that, not the product name.

---

## Vertical vs infra

**Infra first was rejected for now:**

- No users to point to; YC will ask which agent builders use it.
- Microsoft's open-source toolkit already covers fail-closed approval.
- The improvement loop needs real approvals and outcomes, which a vertical produces sooner.

**Kept as an alternative:** an open-source Spec language + validator with developer adoption as traction. Slower to revenue and head-on with Microsoft.

**Vertical class chosen:** back-office work in web portals without usable APIs, where mistakes are irreversible and expensive.

- Integration-based tools cannot reach it; Relay's computer-use seats can.
- Mistakes cost real money, so goal-derived rules earn their keep.
- Outcomes are measurable fast (accepted / rejected / confirmed), feeding outcome checks and the improvement loop.
- Buyers already pay humans for it (an operations headcount line, not a software budget line).
- No spam or reputational risk (unlike a Reddit engagement demo).

Candidates considered, roughly fit vs. difficulty:

1. **Freight and logistics operations** (chosen) — load booking, carrier portals, document filing; high volume; smaller brokers reachable without enterprise sales.
2. Insurance operations — carrier-portal quoting, policy changes, certificates.
3. Healthcare revenue cycle — highest value, but HIPAA and long sales cycles.
4. E-commerce back office — easiest to reach, more crowded, lower value per task.

---

## Why freight suits Relay

The most expensive freight mistakes break **hard rules**, which are the kind deterministic checks and formal methods handle well:

| Risk | Hard rule |
|------|-----------|
| Double-brokering and fraud | Carrier operating authority active; insurance current and above the required minimum |
| Payment fraud | No payment to bank details changed recently without verification |
| Margin leaks | Carrier rate within customer rate minus target margin |
| Duplicates | Same load never booked twice; carrier not on the do-not-use list |
| Window errors | Pickup and delivery windows consistent |

Soft judgments (carrier reliability, quote competitiveness) stay with evals and people. Outcome checks: on-time delivery, realized margin, claims.

**Pitch translation:** competitors say "the agent asks before booking". Relay says: "Relay cannot book a carrier without verified authority and insurance, below your margin floor, or to unverified bank details. That is guaranteed by construction, and every booking carries the evidence."

---

## Verification as differentiation

The research is a moat and a credibility point, not the headline.

| When | Honest claim |
|------|--------------|
| **Now** (no breakthrough needed) | Hard rules enforced by named validator invariants and fail-closed checks, with a full evidence trail per booking |
| **Months** (realistic) | The gating core — the component that decides whether a booking or payment may run — is formally verified (Dafny compiled to JavaScript) |
| **Later** (as research matures) | Each frozen Spec proved against its rules over all paths; fraud-check predicates verified |

Limits:

- A proof only covers the rules written down. New fraud patterns are not covered until a rule exists; human approvals and outcome data reveal the gaps.
- Soft judgments are not provable.
- The research timeline must not block the product: ship with validator invariants, add proofs when ready.

Design constraints that keep verification possible are in the build plan ("Verification-ready constraints") and the research-lab README (Relay OS thread).

---

## YC framing

> Freight brokers lose money to fraud, double-brokering and booking errors in portal work their tools cannot automate safely. Relay's agents do that portal work, and its safety core guarantees they never book or pay outside the broker's rules.

Lead with the customer pain. Keep verification as the reason it is hard to copy. Vertical wedge + computer-use reach + formal-methods moat.

---

## Next steps

1. **Customer discovery (two weeks, starts now, parallel to the build):** talk to 15–20 freight operations people (small and mid-size brokers, dispatchers, carrier-sales reps). Ask which portal work eats their week and what a mistake costs. Goal: one design partner who would try it next month.
2. **Build plan stays as written for now** (CE rebuild as the internal proof of the generator).
3. **Deferred plan changes, once discovery confirms freight:**
   - Second generated workflow: carrier vetting + load booking ("find a carrier within margin, verify authority, insurance and bank details, ask before booking"), using public FMCSA carrier data via the `api` engine and a booking portal via a computer-use seat.
   - A mock load-board portal for demos (real load boards such as DAT and Truckstop have terms of service and require accounts).
   - Freight hard rules as the first Spec rules targeted for verified predicates.
   - A time-boxed task for the verified gating core.

## Open questions

- Which freight segment first: small brokers, dispatch services for owner-operators, or shipper-side logistics teams?
- Which portals dominate the target segment's day (load boards, carrier-onboarding tools, TMS, shipper portals)?
- Who signs off on bookings and payments today, and how are mistakes caught?
- Would brokers' insurers value Relay's evidence trail (possible channel or pricing lever)?
