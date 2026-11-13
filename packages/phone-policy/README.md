# `@relay/phone-policy`

Android phone seat policy on top of `@relay/computer-seat-policy`.

- Leases `kind=phone`
- Default observation: UIAutomator `observe` (+ screenshot)
- Actions: tap / swipe / long_press / launch / system keys (`back`/`home`/`recents`)
- **No** Firefox navigate or `ctrl+l`

Desktop browsing stays in [`@relay/browse-policy`](../browse-policy). Shared loop: [`@relay/computer-seat-policy`](../computer-seat-policy). Fixed-step Settings dogfood stays in `@relay/engines-computer dogfood:phone`.

CommunityEngager stays **desktop evidence-only** — do not wire CE / Reddit execute to phone seats here. Desk HITL claim/watch is a separate plan ([`desk_phone_seats.plan.md`](../../.cursor/plans/desk_phone_seats.plan.md)).

## Quick use

```ts
import { ComputerEngine, ComputerTaskRunner } from "@relay/engines-computer";
import { createLlmClient } from "@relay/llm";
import {
  createLlmPhoneDecider,
  defaultPhoneTiming,
  phoneGoalTask,
} from "@relay/phone-policy";

const engine = new ComputerEngine({
  baseUrl: process.env.COMPUTER_GATEWAY_URL!,
  token: process.env.COMPUTER_API_TOKEN,
});
const decide = createLlmPhoneDecider(createLlmClient({ provider: "gemini" }));
const runner = new ComputerTaskRunner({ engine });
runner.register(phoneGoalTask({ decide, timing: defaultPhoneTiming() }));

await runner.run(
  "phone_goal",
  {
    goal: "Open Settings and open About phone",
    package: "com.android.settings",
    maxSteps: 10,
  },
  { kind: "phone" }
);
```

Helpers: `launchPackage`, `openUri`, `launchApp`, `runPhonePolicyLoop`.

## Dogfood

Fixed-step Settings (no LLM):

```bash
pnpm --filter @relay/engines-computer dogfood:phone
```

LLM Telegram experiment (Amsterdam ❤️):

```bash
COMPUTER_GATEWAY_URL=http://localhost:9000 \
COMPUTER_API_TOKEN=dev-token \
GEMINI_API_KEY=… \
pnpm --filter @relay/phone-policy dogfood:phone-browse
```

On Gemini free-tier 429s, switch provider:

```bash
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=… \
pnpm --filter @relay/phone-policy dogfood:phone-browse
```

Defaults stop early on no-progress: `--max-steps 15`, `--stuck-action 3`, `--stuck-screen 6`, plus Telegram phase budgets (`find_chat` 8 / `in_amsterdam` 6 / `react` 5) via `progressGuard`. Pass `0` for a stuck flag to disable that guard. Override with `--goal "…"`. Watch the physical device (or scrcpy-web on `:6083` if running).
