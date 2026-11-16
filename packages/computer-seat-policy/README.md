# `@relay/computer-seat-policy`

Shared **computer-seat** loop used by desktop and phone policy packs:

- Human-like wait sampling (`SeatTimingConfig`)
- Lease → optional setup → observe → decide → act → park
- Observation hooks (`captureScreenshotObservation` / `captureObserveObservation`)

| Pack | Package |
|------|---------|
| Desktop Firefox | [`@relay/browse-policy`](../browse-policy) |
| Android phone | [`@relay/phone-policy`](../phone-policy) |
| Gateway client | [`@relay/engines-computer`](../engines-computer) |

Policy prompts / Spec wiring stay in those packs, not here. See [`.cursor/plans/phone_policy_split.plan.md`](../../.cursor/plans/phone_policy_split.plan.md).

**Apps:** CommunityEngager + Relay Desk adoption map — [`.cursor/plans/seat_policy_ce_desk_wire.plan.md`](../../.cursor/plans/seat_policy_ce_desk_wire.plan.md) (CE → browse-policy desktop; Desk Seats = HITL/Watch; Spec `computer.browse` already; phone via Desk HITL + phone-policy, not CE Reddit).

