import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  FileJsonActionStore,
  type ActionRecord,
  type ActionStatus,
} from "@relay/action-store";
import type { FeedbackAdapter } from "@relay/feedback-broker";
import type { FeedbackRequest, FeedbackResponse } from "@relay/protocol";
import { CommunityEngagerApp } from "./index.js";
import { formatRunSummary, type RunSummary } from "./job-queue.js";

const E2E_ROOT = path.resolve(process.cwd(), ".data", "e2e");

// Deterministic + never live: fixtures give exactly 2 actionable opportunities.
process.env.SCOUT_SOURCE = "fixtures";
process.env.REDDIT_DRY_RUN = "true";

type ScriptedAction =
  | { kind: "approve" }
  | { kind: "abort" }
  | { kind: "edit"; text: string };

/**
 * Deterministic adapter for CI / local E2E (no stdin, no Telegram).
 * Actions are consumed in request order (one per job); the last repeats.
 */
class ScriptedFeedbackAdapter implements FeedbackAdapter {
  readonly name = "scripted";
  private calls = 0;

  constructor(private readonly actions: ScriptedAction[]) {}

  async present(request: FeedbackRequest): Promise<FeedbackResponse> {
    const action =
      this.actions[Math.min(this.calls, this.actions.length - 1)] ?? {
        kind: "approve" as const,
      };
    this.calls += 1;
    console.log(`  [adapter] ${action.kind} for request ${request.id}`);

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

/** Fails the first store.put to prove a broken job does not sink the queue. */
class FaultyOnceStore extends FileJsonActionStore {
  private injected = false;

  override async put<TPayload = unknown>(
    record: ActionRecord<TPayload>
  ): Promise<void> {
    if (!this.injected) {
      this.injected = true;
      throw new Error("injected store fault (e2e)");
    }
    return super.put(record);
  }
}

interface Expectation {
  jobs: number;
  approved: number;
  aborted: number;
  failed: number;
  storeStatuses?: ActionStatus[];
}

interface ScenarioResult {
  name: string;
  summary: RunSummary;
  storeStatuses: ActionStatus[];
  ok: boolean;
  detail?: string;
}

async function runScenario(
  name: string,
  actions: ScriptedAction[],
  expect: Expectation,
  opts: { faultyStore?: boolean } = {}
): Promise<ScenarioResult> {
  const dir = path.join(E2E_ROOT, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const storePath = path.join(dir, "actions.json");
  const store = opts.faultyStore
    ? new FaultyOnceStore({ filePath: storePath })
    : new FileJsonActionStore({ filePath: storePath });

  const app = new CommunityEngagerApp({
    store,
    adapter: new ScriptedFeedbackAdapter(actions),
    agentId: `e2e-${name}`,
    sessionId: `e2e-sess-${name}`,
    jobDelayMs: 0,
  });

  const summary = await app.run();
  const records = await store.list({ appId: "community-engager", limit: 10 });
  const storeStatuses = records.map((r) => r.status);

  const problems: string[] = [];
  if (summary.jobs.length !== expect.jobs) {
    problems.push(`jobs=${summary.jobs.length} want ${expect.jobs}`);
  }
  if (summary.approved !== expect.approved) {
    problems.push(`approved=${summary.approved} want ${expect.approved}`);
  }
  if (summary.aborted !== expect.aborted) {
    problems.push(`aborted=${summary.aborted} want ${expect.aborted}`);
  }
  if (summary.failed !== expect.failed) {
    problems.push(`failed=${summary.failed} want ${expect.failed}`);
  }
  if (expect.storeStatuses) {
    const got = [...storeStatuses].sort().join(",");
    const want = [...expect.storeStatuses].sort().join(",");
    if (got !== want) problems.push(`store=[${got}] want [${want}]`);
  }

  // Isolation invariant: every job must own a distinct id.
  const ids = new Set(summary.jobs.map((j) => j.id));
  if (ids.size !== summary.jobs.length) {
    problems.push("duplicate job ids — jobs are not isolated");
  }

  return {
    name,
    summary,
    storeStatuses,
    ok: problems.length === 0,
    detail: problems.length ? problems.join("; ") : undefined,
  };
}

async function main(): Promise<void> {
  console.log("=== CommunityEngager E2E · scripted HITL + job isolation ===\n");

  const results: ScenarioResult[] = [];

  console.log("Scenario 1: approve every job → 2 posted");
  results.push(
    await runScenario("approve", [{ kind: "approve" }], {
      jobs: 2,
      approved: 2,
      aborted: 0,
      failed: 0,
      storeStatuses: ["posted", "posted"],
    })
  );

  console.log("\nScenario 2: abort every job → 2 aborted, run still completes");
  results.push(
    await runScenario("abort", [{ kind: "abort" }], {
      jobs: 2,
      approved: 0,
      aborted: 2,
      failed: 0,
      storeStatuses: ["aborted", "aborted"],
    })
  );

  console.log("\nScenario 3: edit every job → 2 posted (edited body)");
  const editText = "Edited E2E reply — help first, no spam.";
  results.push(
    await runScenario("edit", [{ kind: "edit", text: editText }], {
      jobs: 2,
      approved: 2,
      aborted: 0,
      failed: 0,
      storeStatuses: ["posted", "posted"],
    })
  );

  const editStore = new FileJsonActionStore({
    filePath: path.join(E2E_ROOT, "edit", "actions.json"),
  });
  const editRecords = await editStore.list({
    appId: "community-engager",
    limit: 10,
  });
  const allEdited =
    editRecords.length === 2 &&
    editRecords.every(
      (r) => (r.payload as { draftText?: string } | undefined)?.draftText === editText
    );
  if (!allEdited) {
    results[2]!.ok = false;
    results[2]!.detail = "edited draftText did not persist for every job";
  } else {
    console.log("  [ok] edited draftText persisted for both jobs");
  }

  console.log("\nScenario 4: abort job 1, approve job 2 → abort stays scoped");
  results.push(
    await runScenario(
      "isolation-abort",
      [{ kind: "abort" }, { kind: "approve" }],
      {
        jobs: 2,
        approved: 1,
        aborted: 1,
        failed: 0,
        storeStatuses: ["aborted", "posted"],
      }
    )
  );

  console.log("\nScenario 5: job 1 throws (store fault) → job 2 still posts");
  results.push(
    await runScenario(
      "isolation-fault",
      [{ kind: "approve" }],
      {
        jobs: 2,
        approved: 1,
        aborted: 0,
        failed: 1,
        storeStatuses: ["posted"],
      },
      { faultyStore: true }
    )
  );

  console.log("\n── Summary ──");
  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
    console.log(
      formatRunSummary(r.summary)
        .split("\n")
        .map((l) => `      ${l}`)
        .join("\n")
    );
    if (!r.ok) {
      failed += 1;
      console.log(`      → ${r.detail}`);
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
