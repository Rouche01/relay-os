---
name: Consume @useapron/seat
overview: "Done: relay-os consumes published @useapron/seat; @relay/computer-seat-policy removed. Browse/phone prompts stay in relay-os."
todos:
  - id: depend-seat
    content: "Add @useapron/seat (+ @useapron/client) deps; green typecheck for computer-seat-policy / browse / phone"
    status: completed
  - id: shim-policy
    content: "Make @relay/computer-seat-policy a thin re-export of @useapron/seat (or delete and point browse/phone at @useapron/seat)"
    status: completed
  - id: docs-pointers
    content: "READMEs: seat loop is public @useapron/seat; prompts remain browse-policy / phone-policy"
    status: completed
  - id: remove-shim
    content: "After one release window, drop workspace computer-seat-policy source if still shimmed"
    status: completed
isProject: false
---

# Consume `@useapron/seat` ✅

**Canonical plan:** [apron `seat_loop_sdk.plan.md`](../../../apron/.cursor/plans/seat_loop_sdk.plan.md).

## Outcome

| Decision | Choice |
|----------|--------|
| **Owner of loop** | `apron` → npm `@useapron/seat` |
| **Depends on** | `@useapron/client` |
| **Prompts / LLM** | `@relay/browse-policy` / `@relay/phone-policy` |
| **Shim** | `@relay/computer-seat-policy` **deleted** |

```mermaid
flowchart TB
  BP[browse-policy]
  PP[phone-policy]
  Seat["@useapron/seat"]
  Client["@useapron/client"]

  BP --> Seat
  PP --> Seat
  Seat --> Client
```

## References

- Related: [consume computer client](consume_computer_client.plan.md), [phone_policy_split](phone_policy_split.plan.md)
