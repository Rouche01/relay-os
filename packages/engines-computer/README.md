# `@relay/engines-computer`

**Deprecated shim** — prefer [`@useapron/client`](https://www.npmjs.com/package/@useapron/client) directly.

Policy packs and CommunityEngager already depend on `@useapron/client`. This package remains for one release as:

- a re-export barrel of `@useapron/client` (compat for any lingering imports)
- `toExecutionEngine` / `toEngineResult` for `@relay/protocol` bind sites
- fixed-step `dogfood:phone` (Settings on a phone seat)

It will be removed in the `remove-shim` step of [consume_computer_client](../../.cursor/plans/consume_computer_client.plan.md).

## Canonical references

| Doc | Owns |
|-----|------|
| [`@useapron/client` on npm](https://www.npmjs.com/package/@useapron/client) | Typed HTTP client — install / API |
| [computer-with-agent `BINDING.md`](file:///Users/richardemate/Projects/computer-with-agent/BINDING.md) | Lease / park / recycle / observe / action HTTP |
| [computer-with-agent `AGENTS.md`](file:///Users/richardemate/Projects/computer-with-agent/AGENTS.md) | Compose workers, gateway env, seats |

Seat kinds: `desktop` \| `phone`. Omit `kind` on lease for desktop. Phone HITL uses the same `vnc_url` field (noVNC or scrcpy-web).

## New code

```ts
import { ComputerEngine, ComputerTaskRunner } from "@useapron/client";
```

Optional protocol adapter (this package only):

```ts
import { ComputerEngine } from "@useapron/client";
import { toExecutionEngine } from "@relay/engines-computer";

const client = new ComputerEngine({ baseUrl, token });
const engine = toExecutionEngine(client); // ExecutionEngine for bindEngines
```

## Dogfood

| Path | Package | What |
|------|---------|------|
| Fixed-step Settings | this package `dogfood:phone` | Lease phone → launch Settings → observe → park (no LLM) |
| LLM phone goal | [`@relay/phone-policy`](../phone-policy) `dogfood:phone-browse` | Telegram / custom goal via `runPhonePolicyLoop` |
| Desktop browse | [`@relay/browse-policy`](../browse-policy) | Firefox desks (`computer.browse` / `browse_goal`) |

Shared loop: [`@relay/computer-seat-policy`](../computer-seat-policy). CommunityEngager computer transport stays **desktop evidence-only** (not phone).

### Phone Settings (fixed-step)

Requires a free **or soft-parked** phone seat (ADB-reachable). If none are free, dogfood uses `claimPhoneSeat` to acquire a parked phone.

```bash
COMPUTER_GATEWAY_URL=http://localhost:9000 \
COMPUTER_API_TOKEN=dev-token \
pnpm --filter @relay/engines-computer dogfood:phone
```

1. Lease `{ kind: "phone" }`
2. Print `Watch: {vnc_url}` (or “watch the physical device”)
3. Launch Settings → observe → optional swipe / tap About → home
4. Soft-park (pass `--recycle` to wipe)

```bash
pnpm --filter @relay/engines-computer dogfood:phone -- --pause-ms 5000
```

### LLM phone goal

```bash
COMPUTER_GATEWAY_URL=http://localhost:9000 \
COMPUTER_API_TOKEN=dev-token \
GEMINI_API_KEY=… \
pnpm --filter @relay/phone-policy dogfood:phone-browse
```

See `@relay/phone-policy` README (`phone_goal` / `runPhonePolicyLoop`).
