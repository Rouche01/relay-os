---
name: Consume @useapron/seat
overview: "Thin follow-on: depend on @useapron/seat from computer-with-agent; shim or replace @relay/computer-seat-policy. Browse/phone prompts stay in relay-os. Canonical extract lives in the runtime repo."
todos:
  - id: depend-seat
    content: "Add @useapron/seat (+ @useapron/client) deps; green typecheck for computer-seat-policy / browse / phone"
    status: pending
  - id: shim-policy
    content: "Make @relay/computer-seat-policy a thin re-export of @useapron/seat (or delete and point browse/phone at @useapron/seat)"
    status: pending
  - id: docs-pointers
    content: "READMEs: seat loop is public @useapron/seat; prompts remain browse-policy / phone-policy"
    status: pending
  - id: remove-shim
    content: "After one release window, drop workspace computer-seat-policy source if still shimmed"
    status: pending
isProject: false
---

# Consume `@useapron/seat`

**Canonical plan:** [computer-with-agent `seat_loop_sdk.plan.md`](../../../computer-with-agent/.cursor/plans/seat_loop_sdk.plan.md).

This plan is **relay-os migration only**.

## Locked approach

| Decision | Choice |
|----------|--------|
| **Owner of loop** | `computer-with-agent` → `@useapron/seat` |
| **Depends on** | `@useapron/client` (already via seat or engines shim) |
| **Prompts / LLM** | Stay in `@relay/browse-policy` / `@relay/phone-policy` |
| **Transition** | npm dep → shim `@relay/computer-seat-policy` → remove shim |

```mermaid
flowchart TB
  BP[browse-policy]
  PP[phone-policy]
  Shim["@relay/computer-seat-policy shim"]
  Seat["@useapron/seat"]
  Client["@useapron/client"]

  BP --> Shim
  PP --> Shim
  Shim --> Seat
  Seat --> Client
```

## Phased delivery

1. Add `@useapron/seat` (and ensure `@useapron/client` is resolvable)
2. Shim or replace `packages/computer-seat-policy`
3. Update READMEs; keep CE evidence-only desktop semantics unchanged

## Out of scope

- Publishing browse/phone prompts as npm in this pass
- Changing gateway `/v1`

## References

- Canonical: [seat_loop_sdk](../../../computer-with-agent/.cursor/plans/seat_loop_sdk.plan.md)
- Related: [consume computer client](consume_computer_client.plan.md), [phone_policy_split](phone_policy_split.plan.md)
