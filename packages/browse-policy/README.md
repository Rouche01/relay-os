# `@relay/browse-policy`

Human-like browse loop for Computer Runtime desks.

- Waits between actions are sampled from an exponential (or lognormal) distribution.
- Each turn builds a prompt from a **fixed goal** + recent history + the current screenshot.
- A vision LLM returns the next micro-decision (`act` / `done` / `need_human`).
- Desktop I/O goes through `@relay/engines-computer` only — no changes in computer-with-agent.

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

Inference and pacing live here; the gateway only leases, screenshots, and acts.
