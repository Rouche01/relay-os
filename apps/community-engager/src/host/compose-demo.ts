/**
 * Compose POC — Intent → universal compose (engage pack) → freeze → persist
 * → protocol-engine stub walk → CommunityEngager run under that Spec.
 *
 * Docs: docs/compose-demo.md
 */
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { FileJsonActionStore } from "@relay/action-store";
import type { FeedbackAdapter } from "@relay/feedback-broker";
import {
  createIntent,
  createProtocolEngineStub,
  createSpecBundle,
  freezeSpec,
  SPEC_PRIMITIVE_IDS,
  type FeedbackRequest,
  type FeedbackResponse,
} from "@relay/protocol";
import { CommunityEngagerApp } from "../index.js";
import { formatRunSummary } from "../metrics/job-queue.js";
import { composeCommunityIntent } from "../spec/compose-intent.js";
import { createFileSpecStore } from "../spec/file-spec-store.js";
import { formatSpecForHitl } from "../spec/hitl-spec.js";

const DEMO_ROOT = path.resolve(process.cwd(), ".data", "compose-demo");

process.env.SCOUT_SOURCE = "fixtures";
process.env.REDDIT_DRY_RUN = "true";

type Scripted =
  | { kind: "approve" }
  | { kind: "abort" }
  | { kind: "edit"; text: string };

class ScriptedFeedbackAdapter implements FeedbackAdapter {
  readonly name = "scripted-compose";
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

function partitionActions(spec: {
  allowedActions: Array<{ id: string }>;
}): { primitives: string[]; aliases: string[] } {
  const prim = new Set<string>(SPEC_PRIMITIVE_IDS);
  const primitives: string[] = [];
  const aliases: string[] = [];
  for (const a of spec.allowedActions) {
    if (prim.has(a.id)) primitives.push(a.id);
    else aliases.push(a.id);
  }
  return { primitives, aliases };
}

async function main(): Promise<void> {
  console.log("=== Relay compose demo (universal Intent → Spec) ===");
  console.log(
    "Intent → compose(pack) → freeze → persist → protocol stub → CommunityEngager\n"
  );

  await rm(DEMO_ROOT, { recursive: true, force: true });
  await mkdir(DEMO_ROOT, { recursive: true });

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

  banner(2, "composeCommunityIntent → freeze → persist");
  const { intent: compiled, spec: draftSpec, packId } =
    composeCommunityIntent(intent);
  const spec = freezeSpec(draftSpec, { frozenBy: "compose-demo" });
  const { primitives, aliases } = partitionActions(spec);
  console.log(`  packId=${packId}`);
  console.log(`  intent.status=${compiled.status} specId=${compiled.specId}`);
  console.log(
    `  spec=${spec.id} v${spec.version} status=${spec.status} ` +
      `procedure=${spec.procedure.appId}/${spec.procedure.entrypoint}`
  );
  console.log(
    `  compose_pack=${spec.constraints.find((c) => c.id === "compose_pack")?.description}`
  );
  console.log(`  primitives=[${primitives.join(", ")}]`);
  console.log(`  aliases=[${aliases.join(", ")}]`);
  console.log(
    `  budget maxJobs=${spec.budget.maxJobs} dryRun=${spec.budget.dryRun}`
  );
  console.log(`  HITL card: ${formatSpecForHitl(spec).title}`);

  const specStore = createFileSpecStore(DEMO_ROOT);
  await specStore.put(
    createSpecBundle(compiled, spec, { appId: "community-engager" })
  );
  console.log(`  persisted → ${specStore.path}`);

  banner(3, "Protocol engine stub (same Spec)");
  const engine = createProtocolEngineStub();
  const session = await engine.declare(spec);
  const obs = await session.observe({ query: "allowlist" });
  console.log(`  observe ok query=${obs.query} stub=${String(obs.data.stub)}`);
  session.recordEvidence("scout_complete", {
    status: "satisfied",
    detail: "compose-demo stub",
  });
  session.recordEvidence("draft_present", {
    status: "satisfied",
    detail: "compose-demo stub",
  });
  session.recordEvidence("hitl_decision", {
    status: "satisfied",
    detail: "compose-demo stub",
  });
  session.recordEvidence("execute_evidence", {
    status: "satisfied",
    detail: "compose-demo stub",
  });
  session.recordEvidence("intensity2_gate", {
    status: "satisfied",
    detail: "compose-demo stub",
  });
  const pack = session.evidence("pre_execute");
  console.log(
    `  evidence pre_execute complete=${pack.complete} blocking=[${pack.blocking.join(", ")}]`
  );
  const write = await session.invoke({
    actionId: "write",
    primitive: "write",
    params: { body: "would-post" },
  });
  console.log(
    `  write dryRunSimulated=${Boolean(write.dryRunSimulated)} success=${write.success}`
  );
  const denied = await session.invoke({
    actionId: "launch_nukes",
    primitive: "invoke",
  });
  console.log(
    `  refuse out-of-spec: success=${denied.success} err=${(denied.error ?? "").slice(0, 72)}`
  );
  await session.teardown();

  banner(4, "CommunityEngager run under composed Spec");
  console.log("  (scripted: Approve Spec, then Approve each draft)\n");

  const store = new FileJsonActionStore({
    filePath: path.join(DEMO_ROOT, "actions.json"),
  });
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
    agentId: "compose-demo",
    sessionId: `compose-${Date.now()}`,
    maxJobs: 2,
    jobDelayMs: 0,
  });

  const summary = await app.run();

  banner(5, "Result");
  console.log(formatRunSummary(summary));
  const reloaded = await specStore.get(spec.id);
  console.log(
    `  Spec store reload: ${reloaded ? `ok pack≈${reloaded.spec.constraints.find((c) => c.id === "compose_pack")?.description}` : "MISSING"}`
  );

  const ok =
    packId === "community-engager/engage" &&
    primitives.includes("observe") &&
    primitives.includes("write") &&
    aliases.includes("post_comment") &&
    write.dryRunSimulated === true &&
    denied.success === false &&
    summary.runState === "COMPLETE" &&
    summary.jobs.length >= 1 &&
    summary.approved >= 1 &&
    summary.failed === 0 &&
    Boolean(reloaded);

  console.log("\n── Checklist ──");
  console.log(`  [x] Intent created`);
  console.log(`  [x] composeCommunityIntent (pack=${packId})`);
  console.log(`  [x] Spec has primitives + aliases`);
  console.log(`  [x] Spec frozen + persisted`);
  console.log(`  [x] Protocol stub observe / evidence / dry-run write`);
  console.log(`  [x] Spec HITL → CommunityEngager stages → draft HITL → dry-run`);
  console.log(
    ok
      ? "\nCompose demo PASSED.\n"
      : "\nCompose demo FAILED — see summary above.\n"
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
