# Relay: pitch (draft)

One-page version. Beliefs and reasoning live in [`manifesto.md`](./manifesto.md). Vertical choice and competitor detail live in [`positioning-freight.md`](./positioning-freight.md). Rewrite as customer discovery changes the picture.

## One line

Freight brokers lose money to fraud, double-brokering and booking errors in portal work their tools cannot automate safely. Relay's agents do that portal work, and its safety core guarantees they never book or pay outside the broker's rules.

## The problem

Freight operations teams spend their week in carrier portals, load boards and TMS screens that have no usable API. People do this work by hand because the mistakes are expensive and irreversible:

- Booking a carrier with lapsed authority or insurance (double-brokering and fraud exposure).
- Paying to bank details that changed recently.
- Booking the same load twice.
- Going below the margin floor.

Today's automation cannot reach these portals, and "agents that ask before they act" are not trusted with the money.

## The product

A broker states what they want done, in plain language. For example: "Find a carrier within margin, verify authority, insurance and bank details, and ask me before booking."

1. **Intent to Spec.** Relay turns the request into an explicit spec: the steps, plus the rules the work must never break.
2. **Human approval.** The broker reviews and approves the spec. They approve intent, not code.
3. **Run.** The approved spec becomes a workflow. Relay's agents run it, using APIs where they exist and a computer-use seat where they don't.
4. **Checkpoints.** At a human checkpoint, the broker takes over in the same screen the agent was using, acts, and hands back.
5. **Evidence.** Every booking carries the evidence for each rule it was checked against.

## Why it is hard to copy

Competitors gate actions ("this tool needs approval"). Relay derives rules from the goal and checks them three times: when the spec is written, on every output at run time, and against outcomes afterwards.

- **Guaranteed by construction.** Relay cannot book a carrier without verified authority and insurance, below your margin floor, or to unverified bank details.
- **It learns from approvals.** Approve, edit and abort decisions tighten the rules over time.
- **It reaches where integrations stop.** Computer-use seats run under the same rules as API work.
- **Verification is the long-term moat.** The gating core that decides whether a booking or payment may run is being formally verified. Today the rules are enforced by validator checks that fail closed.

Soft judgments, such as carrier reliability and quote competitiveness, stay with evals and people. A proof only covers the rules written down, and approvals and outcome data reveal the gaps.

## Why freight, why now

- High volume, with work that is paid for today as an operations headcount line, not a software budget line.
- Hard rules that deterministic checks handle well.
- Outcomes measured fast (accepted, rejected, confirmed, on-time, realized margin), which feeds the improvement loop.
- Smaller and mid-size brokers are reachable without enterprise sales.
- Generating software is now cheap, so the bottleneck is trust. Relay sells the trust layer.

## Where it goes

Freight is the wedge. The same pattern applies to other portal-heavy, irreversible back-office work such as insurance operations. Longer term, we plan a GUI-like protocol for agent sessions, so humans and agents act on a shared surface that needs no computer engine.

## What we need to learn

- Which freight segment first: small brokers, dispatch services for owner-operators, or shipper-side logistics teams.
- Which portals dominate their day.
- Who signs off on bookings and payments today, and how mistakes are caught.
- Whether insurers would value the evidence trail.

**Next:** 15 to 20 conversations with freight operations people over two weeks, aiming for one design partner who would try it next month.
