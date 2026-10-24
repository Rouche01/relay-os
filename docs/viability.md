# Relay — viability insight

Snapshot of why this direction is viable, where it isn’t, and how to pitch it. Rewrite as the product and market shift. Companion to the thesis in [`README.md`](../README.md) and the readiness plan [`.cursor/plans/relay_intent_spec_verify_hitl.plan.md`](../.cursor/plans/relay_intent_spec_verify_hitl.plan.md).

**Thesis:** Agents that compile intent into a frozen spec, run against it, prove acceptance, and negotiate with you before they act.

**Computer work:** Spec is the addressable surface. **Protocol engine preferred** when systems expose Spec-shaped capabilities; **browser / computer-use** is the fallback for GUI-only systems. Agents don’t always need a task GUI — they need a Spec-native way to act. Governance UIs (freeze Spec, HITL, evidence) remain.

---

## Verdict

**Viable as a company direction — with a narrow wedge.** Not “GUIs vanish overnight,” not “we invent the next OS next quarter.” Viable if Relay owns **Spec as the trust layer for agent action**.

---

## What’s highly viable

| Signal | Why |
|--------|-----|
| **Problem is real and growing** | Computer-use and browser agents are flaky, expensive, and unsafe without authority boundaries. “Who approved this?” and “Is it done?” are already felt. |
| **Architecture split is right** | Protocol when Spec-addressable; GUI automation when not. Same pattern as every platform shift (APIs first, scrape the long tail). |
| **Differentiation is clear** | Many ship “agent that clicks.” Fewer ship **Intent → frozen Spec → evidence → negotiate → act** as the product. |
| **Foothold exists** | CommunityEngager + HITL + browser engine + Decide policy is a real dogfood path, not a slide deck. |

---

## Hard risks (honest)

| Risk | Mitigation |
|------|------------|
| **Protocol adoption is chicken-and-egg** | Until third parties expose Spec-native surfaces, product looks like “best Spec-bound browser agent.” Still useful; easier to copy — so move fast on trust UX and one vertical. |
| **Crowded neighborhood** | Browser agents, MCP, RPA, HITL inboxes, agent frameworks. Win on **Spec as law**, not on “we automate the web.” |
| **Intent-native / no-task-GUI is a long bet** | Keep as north star. Fatal if it’s the only story before Spec-governed procedures are demoable and credible. |
| **Category education cost** | Buyers understand a job (“community posting with approval”). They don’t yet buy “Spec protocol.” Lead with a job; reveal the platform. |
| **Horizontal “agent OS” without a vertical** | Low viability. Always name the first workflow and who pays. |

---

## Viability by layer

| Layer | Viability | Notes |
|-------|-----------|--------|
| Spec + HITL + evidence for agent actions | **High** | Core product bet |
| Browser / computer-use bound by Spec | **High** | Near-term product (CommunityEngager dogfood) |
| Spec-native protocol as preferred path | **Medium–high** | Technically sound; distribution hard |
| Intent-native apps replacing task GUIs | **Medium (long-term)** | Directionally right; timing uncertain |
| Horizontal agent OS without a vertical | **Low** | Avoid as the pitch |

---

## Path that stays viable

1. **One painful Spec-bound procedure** (engage / community HITL first)  
2. **Prove** trust: freeze → run → evidence → negotiate → act  
3. **Open protocol** for systems you control (or that already have APIs)  
4. **Browser** for the long tail that only speaks GUI  
5. **Only then** lean into Spec-derived intent-native application format  

The idea fails if you sell the future (“no GUIs”) before the Spec loop is undeniable.  
It works if every demo makes someone say: *that’s how agents should be allowed to act.*

---

## YC pitch shape

**Good YC-shaped idea** — not an automatic acceptance lock.

### Why it fits

- Clear one-liner (thesis above)  
- Real insight: protocol preferred, GUI computer-use as fallback — not “another browser agent”  
- Vertical / workflow energy: Spec-owned procedures that replace clicking through work  
- Hard problem: trust, authority, and “done” for agents  
- Demo path: CommunityEngager can show the loop once Spec + evidence are real  

### What interviewers will stress-test

- **Wedge:** Who pays first, for which job?  
- **POC vs thesis:** Pitch protocol only as far as the demo proves  
- **Why you:** Shipping HITL + browser dogfood  
- **Competition:** vs RPA, MCP, lab computer-use, approval inboxes — answer is Spec as law + negotiate-then-act  

### Pitch line

> We’re building the Spec layer for agent computer work: intent freezes into an inspectable Spec; agents run via protocol when they can and browser when they must; nothing irreversible happens without proof and human negotiation.

Lead with **vertical + Spec→HITL demo**. Protocol is the architecture; intent-native apps are the dream — not the first slide.

---

## What this is not claiming

- GUIs disappear entirely (governance and exception surfaces stay)  
- Formal vericoding / proof IR ships in Relay MVP (that stays in research-lab until high-stakes stages need it)  
- Third-party Spec protocol adoption is required for v1 readiness  

---

## Log

### 2026-10-24

- Captured viability + YC pitch insight after architecture clarity: Spec-addressable computer work; protocol preferred; browser fallback.
