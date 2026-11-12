# `@relay/engines-computer`

Typed HTTP client for the [computer-with-agent](https://github.com/) Computer Runtime gateway: lease / screenshot / observe / action / park / recycle.

Supports seat **`kind: "desktop" | "phone"`**. Omit `kind` on lease for desktop (existing callers unchanged). Phone seats use the same `vnc_url` field for HITL (noVNC or scrcpy-web).

Upstream contract notes: `computer-with-agent` `AGENTS.md` / `BINDING.md` (phone actions, observe, inventory).

## Dogfood

| Path | Package | What |
|------|---------|------|
| Fixed-step Settings | this package `dogfood:phone` | Lease phone → launch Settings → observe → park (no LLM) |
| LLM phone goal | [`@relay/phone-policy`](../phone-policy) `dogfood:phone-browse` | Telegram / custom goal via `runPhonePolicyLoop` |
| Desktop browse | [`@relay/browse-policy`](../browse-policy) | Firefox desks only (`computer.browse` / `browse_goal`) |

Shared loop chassis: [`@relay/computer-seat-policy`](../computer-seat-policy). CommunityEngager computer transport stays **desktop evidence-only** (not phone).

### Phone Settings (fixed-step)

Requires a free **or soft-parked** phone seat (ADB-reachable). If none are free, dogfood uses `claimPhoneSeat` to acquire a parked phone.

```bash
COMPUTER_GATEWAY_URL=http://localhost:9000 \
COMPUTER_API_TOKEN=dev-token \
pnpm --filter @relay/engines-computer dogfood:phone
```

What it does:

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
