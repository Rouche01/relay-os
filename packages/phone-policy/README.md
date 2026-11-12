# `@relay/phone-policy`

Android phone seat policy on top of `@relay/computer-seat-policy`.

- Leases `kind=phone`
- Default observation: UIAutomator `observe` (+ screenshot)
- Actions: tap / swipe / long_press / launch / system keys (`back`/`home`/`recents`)
- **No** Firefox navigate or `ctrl+l`

Desktop browsing stays in `@relay/browse-policy`. Fixed-step Settings dogfood stays in `@relay/engines-computer dogfood:phone`.

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
