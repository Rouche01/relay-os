# `@relay/computer-seat-policy`

**Deprecated shim** — prefer [`@useapron/seat`](https://www.npmjs.com/package/@useapron/seat) directly.

Re-exports the shared seat loop (wait → observe → decide → act → park) from `@useapron/seat`. Prompts / LLM deciders stay in the policy packs.

| Pack | Package |
|------|---------|
| Desktop Firefox | [`@relay/browse-policy`](../browse-policy) |
| Android phone | [`@relay/phone-policy`](../phone-policy) |
| Seat loop | [`@useapron/seat`](https://www.npmjs.com/package/@useapron/seat) |
| Gateway client | [`@useapron/client`](https://www.npmjs.com/package/@useapron/client) |

See [`.cursor/plans/consume_seat_loop.plan.md`](../../.cursor/plans/consume_seat_loop.plan.md). CE + Desk wiring: [`.cursor/plans/seat_policy_ce_desk_wire.plan.md`](../../.cursor/plans/seat_policy_ce_desk_wire.plan.md).
