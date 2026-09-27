import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  FileJsonActionStore,
  type ActionStatus,
} from "@relay/action-store";
import { FeedbackBroker, type FeedbackAdapter } from "@relay/feedback-broker";
import type { FeedbackRequest, FeedbackResponse } from "@relay/protocol";
import { AgentRuntimeEvent } from "@relay/protocol";
import { CommunityEngagerApp } from "./index.js";

const E2E_ROOT = path.resolve(process.cwd(), ".data", "e2e");

type ScriptedAction =
  | { kind: "approve" }
  | { kind: "abort" }
  | { kind: "edit"; text: string };

/** Deterministic adapter for CI / local E2E (no stdin, no Telegram). */
class ScriptedFeedbackAdapter implements FeedbackAdapter {
  readonly name = "scripted";

  constructor(private readonly action: ScriptedAction) {}

  async present(request: FeedbackRequest): Promise<FeedbackResponse> {
    console.log(`  [adapter] ${this.action.kind} for request ${request.id}`);

    if (this.action.kind === "abort") {
      return {
        requestId: request.id,
        agentId: request.agentId,
        action: "abort",
        value: false,
      };
    }
    if (this.action.kind === "edit") {
      return {
        requestId: request.id,
        agentId: request.agentId,
        action: "proceed",
        value: this.action.text,
      };
    }
    return {
      requestId: request.id,
      agentId: request.agentId,
      action: "proceed",
      value: true,
    };
  }
}

interface ScenarioResult {
  name: string;
  agentState: string;
  storeStatus: ActionStatus | null;
  transitions: string[];
  ok: boolean;
  detail?: string;
}

async function runScenario(
  name: string,
  action: ScriptedAction,
  expect: { agentState: string; storeStatus: ActionStatus }
): Promise<ScenarioResult> {
  const dir = path.join(E2E_ROOT, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const storePath = path.join(dir, "actions.json");
  const store = new FileJsonActionStore({ filePath: storePath });
  const transitions: string[] = [];

  const app = new CommunityEngagerApp({
    store,
    agentId: `e2e-${name}`,
    sessionId: `e2e-sess-${name}`,
  });
  const runtime = app.getRuntime();

  runtime.on(AgentRuntimeEvent.STATE_CHANGED, ({ state }) => {
    transitions.push(`state:${state}`);
    console.log(`  [transition] state → ${state}`);
  });
  runtime.on(AgentRuntimeEvent.FEEDBACK_APPLIED, ({ response }) => {
    transitions.push(`feedback:${response.action ?? "proceed"}`);
    console.log(`  [transition] feedback → ${response.action ?? "proceed"}`);
  });

  const broker = new FeedbackBroker(runtime, {
    adapter: new ScriptedFeedbackAdapter(action),
  });
  broker.attach();

  try {
    await runtime.start();
  } finally {
    broker.detach();
  }

  const agentState = runtime.getState();
  const records = await store.list({ appId: "community-engager", limit: 1 });
  const storeStatus = records[0]?.status ?? null;

  const ok =
    agentState === expect.agentState && storeStatus === expect.storeStatus;

  return {
    name,
    agentState,
    storeStatus,
    transitions,
    ok,
    detail: ok
      ? undefined
      : `expected agent=${expect.agentState} store=${expect.storeStatus}; got agent=${agentState} store=${storeStatus}`,
  };
}

async function main(): Promise<void> {
  console.log("=== CommunityEngager E2E · CLI/scripted HITL ===\n");

  const results: ScenarioResult[] = [];

  console.log("Scenario 1: approve → posted / COMPLETE");
  results.push(
    await runScenario("approve", { kind: "approve" }, {
      agentState: "COMPLETE",
      storeStatus: "posted",
    })
  );

  console.log("\nScenario 2: abort → aborted / ABORTED");
  results.push(
    await runScenario("abort", { kind: "abort" }, {
      agentState: "ABORTED",
      storeStatus: "aborted",
    })
  );

  console.log("\nScenario 3: edit → posted / COMPLETE (edited body)");
  results.push(
    await runScenario(
      "edit",
      { kind: "edit", text: "Edited E2E reply — help first, no spam." },
      {
        agentState: "COMPLETE",
        storeStatus: "posted",
      }
    )
  );

  // Extra assert: edited payload text persisted through execute
  const editStore = new FileJsonActionStore({
    filePath: path.join(E2E_ROOT, "edit", "actions.json"),
  });
  const editRecords = await editStore.list({ appId: "community-engager", limit: 1 });
  const editedText = (editRecords[0]?.payload as { draftText?: string } | undefined)
    ?.draftText;
  const editTextOk = editedText === "Edited E2E reply — help first, no spam.";
  if (!editTextOk) {
    results[2].ok = false;
    results[2].detail = `edited draftText mismatch: ${JSON.stringify(editedText)}`;
  } else {
    console.log("  [ok] edited draftText persisted in action store");
  }

  console.log("\n── Summary ──");
  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    console.log(
      `${mark}  ${r.name}  agent=${r.agentState}  store=${r.storeStatus}  transitions=[${r.transitions.join(", ")}]`
    );
    if (!r.ok) {
      failed += 1;
      console.log(`       ${r.detail}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} scenario(s) failed`);
    process.exit(1);
  }
  console.log("\nAll E2E scenarios passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
