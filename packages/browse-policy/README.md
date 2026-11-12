# `@relay/browse-policy`

Human-like browse loop for Computer Runtime desks **and phone seats**.

- Waits between actions are sampled from an exponential (or lognormal) distribution.
- Each turn builds a prompt from a **fixed goal** + recent history + the current screenshot (phone: optional UIAutomator element list via `observe`).
- A vision LLM returns the next micro-decision (`act` / `done` / `need_human`).
- Desktop / phone I/O goes through `@relay/engines-computer` only — no changes in computer-with-agent.
- Phone: set `seatKind: "phone"` (leases `kind=phone`, skips Firefox navigate, swipe-heavy prompt). Upstream notes: computer-with-agent `AGENTS.md` / `BINDING.md`.

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

// Phone seat (no Firefox address bar — launch / current screen):
await runner.run(
  "browse_goal",
  {
    goal: "Open Settings and open About phone",
    seatKind: "phone",
    maxSteps: 10,
  },
  { kind: "phone" }
);
```

Fixed-step (no LLM) phone dogfood: `pnpm --filter @relay/engines-computer dogfood:phone`.

Inference and pacing live here; the gateway only leases, screenshots/observe, and acts.

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
