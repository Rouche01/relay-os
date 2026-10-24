/**
 * Cold thesis demo — Intent → Spec → Spec HITL → run → evidence → draft HITL → act.
 *
 * Deterministic: fixtures scout + dry-run + scripted Approve.
 * Docs: docs/thesis-demo.md (repo root docs/)
 */
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { FileJsonActionStore } from "@relay/action-store";
import type { FeedbackAdapter } from "@relay/feedback-broker";
import {
  createIntent,
  createSpecBundle,
  freezeSpec,
  type FeedbackRequest,
  type FeedbackResponse,
} from "@relay/protocol";
import { CommunityEngagerApp } from "../index.js";
import { formatRunSummary } from "../metrics/job-queue.js";
import { compileEngageIntent } from "../spec/engage-compiler.js";
import { createFileSpecStore } from "../spec/file-spec-store.js";
import { formatSpecForHitl } from "../spec/hitl-spec.js";

const DEMO_ROOT = path.resolve(process.cwd(), ".data", "thesis-demo");

process.env.SCOUT_SOURCE = "fixtures";
process.env.REDDIT_DRY_RUN = "true";

type Scripted =
  | { kind: "approve" }
  | { kind: "abort" }
  | { kind: "edit"; text: string };

class ScriptedFeedbackAdapter implements FeedbackAdapter {
  readonly name = "scripted-thesis";
  private i = 0;
  constructor(private readonly actions: Scripted[]) {}

  async present(request: FeedbackRequest): Promise<FeedbackResponse> {
    const action =
      this.actions[Math.min(this.i, this.actions.length - 1)] ?? {
        kind: "approve" as const,
      };
    this.i += 1;
    const metaKind = request.context?.meta?.kind;
    console.log(
      `  → HITL ${action.kind}` +
        (metaKind === "spec_freeze" ? " (Spec)" : " (draft)") +
        `  request=${request.id}`
    );
    if (action.kind === "abort") {
      return {
        requestId: request.id,
        agentId: request.agentId,
        action: "abort",
        value: false,
      };
    }
    if (action.kind === "edit") {
      return {
        requestId: request.id,
        agentId: request.agentId,
        action: "proceed",
        value: action.text,
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

function banner(step: number, title: string): void {
  console.log(`\n── ${step}. ${title} ──`);
}

async function main(): Promise<void> {
  console.log("=== Relay thesis demo (CommunityEngager) ===");
  console.log(
    "Intent → frozen Spec → Spec HITL → run → evidence → draft HITL → dry-run act\n"
  );

  await rm(DEMO_ROOT, { recursive: true, force: true });
  await mkdir(DEMO_ROOT, { recursive: true });

  // 1. Intent
  banner(1, "Intent");
  const intent = createIntent({
    goal: "Helpful fashion-community replies under HITL; dry-run only",
    slots: {
      entrypoint: "engage",
      maxJobs: 2,
      dryRun: true,
      allowPromo: true,
      adapter: "cli",
    },
  });
  console.log(`  id=${intent.id}`);
  console.log(`  goal=${intent.goal}`);
  console.log(`  slots=${JSON.stringify(intent.slots)}`);

  // 2. Compile → draft Spec → freeze
  banner(2, "Compile Intent → Spec → freeze");
  const { intent: compiled, spec: draftSpec } = compileEngageIntent(intent);
  const spec = freezeSpec(draftSpec, { frozenBy: "thesis-demo" });
  console.log(`  intent.status=${compiled.status} specId=${compiled.specId}`);
  console.log(
    `  spec=${spec.id} v${spec.version} status=${spec.status} ` +
      `procedure=${spec.procedure.appId}/${spec.procedure.entrypoint}`
  );
  console.log(
    `  budget maxJobs=${spec.budget.maxJobs} dryRun=${spec.budget.dryRun}`
  );
  console.log(
    `  acceptance=[${spec.acceptance.map((a) => a.id).join(", ")}]`
  );
  const card = formatSpecForHitl(spec);
  console.log(`  HITL card title: ${card.title}`);

  const specStore = createFileSpecStore(DEMO_ROOT);
  await specStore.put(
    createSpecBundle(compiled, spec, { appId: "community-engager" })
  );
  console.log(`  persisted → ${specStore.path} (id=${spec.id})`);

  // 3–6. Run with Spec HITL + draft HITL (scripted approve)
  banner(3, "Spec HITL → stages → evidence → draft HITL → execute");
  console.log("  (scripted: Approve Spec, then Approve each draft)\n");

  const store = new FileJsonActionStore({
    filePath: path.join(DEMO_ROOT, "actions.json"),
  });
  // Spec approve + up to 2 draft approves (and optional intensity confirms)
  const adapter = new ScriptedFeedbackAdapter([
    { kind: "approve" },
    { kind: "approve" },
    { kind: "approve" },
    { kind: "approve" },
  ]);

  const app = new CommunityEngagerApp({
    store,
    adapter,
    spec,
    intent: compiled,
    specStore,
    specHitl: true,
    agentId: "thesis-demo",
    sessionId: `thesis-${Date.now()}`,
    maxJobs: 2,
    jobDelayMs: 0,
  });

  const summary = await app.run();

  banner(4, "Result");
  console.log(formatRunSummary(summary));
  const reloaded = await specStore.get(spec.id);
  console.log(
    `  Spec store reload: ${reloaded ? `ok v${reloaded.spec.version} status=${reloaded.spec.status}` : "MISSING"}`
  );

  const ok =
    summary.runState === "COMPLETE" &&
    summary.jobs.length >= 1 &&
    summary.approved >= 1 &&
    summary.failed === 0 &&
    Boolean(reloaded);

  console.log("\n── Checklist ──");
  console.log(`  [x] Intent created`);
  console.log(`  [x] Spec compiled + frozen`);
  console.log(`  [x] Spec persisted (Intent+Spec bundle)`);
  console.log(`  [x] Spec HITL (Approve)`);
  console.log(`  [x] Runtime bound to Spec (dry-run / maxJobs)`);
  console.log(`  [x] Evidence pack before execute`);
  console.log(`  [x] Draft HITL → dry-run act`);
  console.log(
    ok
      ? "\nThesis demo PASSED.\n"
      : "\nThesis demo FAILED — see summary above.\n"
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
