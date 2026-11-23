---
name: Consume computer-with-agent client
overview: "Done: relay-os consumes published @useapron/client; @relay/engines-computer shim removed."
todos:
  - id: add-npm-dep
    content: Add @useapron/client npm dep to engines-computer or direct consumers; green typecheck + CE/policy tests
    status: completed
  - id: shim-package
    content: Make @relay/engines-computer a thin re-export (+ optional ExecutionEngine adapter) of @useapron/client
    status: completed
  - id: switch-deps
    content: computer-seat-policy, browse-policy, phone-policy, community-engager depend on @useapron/client (or shim); drop workspace engines-computer source
    status: completed
  - id: docs-pointers
    content: engines-computer README → points at npm @useapron/client + computer-with-agent BINDING; Desk/LAPTOP notes if needed
    status: completed
  - id: remove-shim
    content: After one release window, delete @relay/engines-computer; import @useapron/client everywhere
    status: completed
isProject: false
---

# Consume `@useapron/client` ✅

**Canonical plan:** [computer-with-agent `ts_client_sdk.plan.md`](../../../computer-with-agent/.cursor/plans/ts_client_sdk.plan.md).

## Outcome

| Decision | Choice |
|----------|--------|
| **Owner of client** | `computer-with-agent` → npm `@useapron/client` |
| **relay-os role** | Direct consumer (`^0.1.2`) |
| **Shim** | `@relay/engines-computer` **deleted** |
| **Protocol** | `ComputerEngine` used structurally where `ExecutionEngine` is needed; no `@relay/*` in the client |
| **Dogfood** | Fixed-step Settings → `@relay/phone-policy dogfood:phone`; LLM → `dogfood:phone-browse` |

## Consumers

| Package / app | Dep |
|---------------|-----|
| `@relay/computer-seat-policy` | `@useapron/client` |
| `@relay/browse-policy` | `@useapron/client` |
| `@relay/phone-policy` | `@useapron/client` |
| `apps/community-engager` | `@useapron/client` |

Gateway contract: [BINDING.md](file:///Users/richardemate/Projects/computer-with-agent/BINDING.md).

## References

- Related: [phone_policy_split](phone_policy_split.plan.md), [seat_policy_ce_desk_wire](seat_policy_ce_desk_wire.plan.md), [computer_phone_seat_bind](computer_phone_seat_bind.plan.md)
