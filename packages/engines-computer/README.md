# `@relay/engines-computer`

Typed HTTP client for the [computer-with-agent](https://github.com/) Computer Runtime gateway: lease / screenshot / observe / action / park / recycle.

Supports seat **`kind: "desktop" | "phone"`**. Omit `kind` on lease for desktop (existing callers unchanged). Phone seats use the same `vnc_url` field for HITL (noVNC or scrcpy-web).

Upstream contract notes: `computer-with-agent` `AGENTS.md` / `BINDING.md` (phone actions, observe, inventory).

## Phone dogfood

Requires a free phone seat in the gateway inventory and an ADB-reachable device.

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

Pause after lease so you can open the Watch URL or look at the handset:

```bash
pnpm --filter @relay/engines-computer dogfood:phone -- --pause-ms 5000
```

For an LLM-driven phone goal loop, use `@relay/browse-policy` with `seatKind: "phone"` (see that package’s README).
