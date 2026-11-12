# `@relay/browse-policy`

Human-like browse loop for Computer Runtime **desktop** desks (Firefox).

Shared lease / wait / observe / decide / act / park loop lives in `@relay/computer-seat-policy`. Android phone automation lives in `@relay/phone-policy`.

- Waits between actions are sampled from an exponential (or lognormal) distribution.
- Each turn builds a prompt from a **fixed goal** + recent history + the current screenshot.
- A vision LLM returns the next micro-decision (`act` / `done` / `need_human`).
- Desk I/O goes through `@relay/engines-computer` only.

## Quick use

```ts
import { ComputerEngine, ComputerTaskRunner } from "@relay/engines-computer";
import { createLlmClient } from "@relay/llm";
import {
  browseGoalTask,
  createLlmBrowseDecider,
  defaultBrowseTiming,
} from "@relay/browse-policy";

const engine = new ComputerEngine({
  baseUrl: process.env.COMPUTER_GATEWAY_URL!,
  token: process.env.COMPUTER_API_TOKEN,
});
const decide = createLlmBrowseDecider(createLlmClient({ provider: "gemini" }));
const runner = new ComputerTaskRunner({ engine });
runner.register(browseGoalTask({ decide, timing: defaultBrowseTiming() }));

await runner.run("browse_goal", {
  goal: "Find the pricing page and stop when you can see plan names",
  url: "https://example.com",
  maxSteps: 12,
});
```

Phone seats: [`@relay/phone-policy`](../phone-policy) (`phone_goal` / `runPhonePolicyLoop`). Fixed-step Settings: `pnpm --filter @relay/engines-computer dogfood:phone`.

`seatKind: "phone"` on browse APIs is removed — callers get an explicit error pointing at phone-policy.

CommunityEngager does **not** use this package for phone; CE computer paths stay desktop evidence-only.

Inference and pacing live here; the gateway only leases, screenshots, and acts.


## Spec v2 (`computer.browse`)

Opt in with a Spec step `use: "computer.browse"` and decorate the workflow controller:

```ts
import { createWorkflowRuntime } from "@relay/workflow-runtime";
import {
  createLlmBrowseDecider,
  withBrowsePolicy,
} from "@relay/browse-policy";
import { createLlmClient } from "@relay/llm";

const decide = createLlmBrowseDecider(createLlmClient({ provider: "gemini" }));

const { runtime } = createWorkflowRuntime({
  lowered,
  engines,
  context,
  decorateController: (base, { getContext }) =>
    withBrowsePolicy(base, {
      lowered,
      getContext,
      decide,
      engines,
    }),
});
```

Other steps still run through `WorkflowController`. `need_human` pauses on the stage’s browse feedback point; Abort hard-stops the run.
