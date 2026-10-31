/**
 * Cold E2E triage demo — intent → Spec → freeze → shadow → approve → enable →
 * live tick ×2 (once idempotency). Default path is offline (fixtures + stub LLM).
 *
 * Docs: docs/triage-demo.md
 *
 * Optional: GITHUB_TOKEN + --live-github for live list reads in shadow.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRelayAppBundle } from "@relay/app-bundle";
import type { LlmClient, LlmJsonRequest, LlmJsonResult } from "@relay/llm";
import {
  createDraftSpecV2,
  freezeSpecV2,
  listEnabledSchedules,
  type SpecV2Body,
} from "@relay/protocol";
import { loadCuratedServices } from "@relay/services";
import {
  approveShadowEvidence,
  createFileJsonDataStore,
  createFileRunStateStore,
  createMemoryConnectionStore,
  enableSpecScheduler,
  isSpecHostError,
  runSpec,
  tryCreateLiveLlmClient,
} from "@relay/spec-host";
import { parseSpecV2Yaml, validateSpecV2 } from "@relay/spec-validator";

function packageRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (
      existsSync(join(dir, "package.json")) &&
      existsSync(join(dir, "intent.md")) &&
      existsSync(join(dir, "spec.expected.yaml"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("triage-gen package root not found");
    }
    dir = parent;
  }
}

const ROOT = packageRoot(dirname(fileURLToPath(import.meta.url)));
const DEMO_ROOT = join(ROOT, ".data", "triage-demo");

export type DemoResult = {
  ok: boolean;
  mode: "fixture" | "live-github";
  specHash: string;
  shadowRunId: string;
  tick1PostCount: number;
  tick2PostCount: number;
  tick2OnceSkips: number;
  notes: string[];
};

function banner(step: number, title: string): void {
  console.log(`\n── ${step}. ${title} ──`);
}

function loadIssuesFixture(): unknown[] {
  return JSON.parse(
    readFileSync(join(ROOT, "fixtures", "issues.json"), "utf8")
  ) as unknown[];
}

function loadExpectedBody(): SpecV2Body {
  const yaml = readFileSync(join(ROOT, "spec.expected.yaml"), "utf8");
  return parseSpecV2Yaml(yaml);
}

function loadIntentText(): string {
  return readFileSync(join(ROOT, "intent.md"), "utf8").trim();
}

/** Stub LLM: triage drafts + soft-rule judge scores. */
export function triageStubLlm(): LlmClient {
  return {
    provider: "gemini",
    async completeJson(req: LlmJsonRequest): Promise<LlmJsonResult> {
      const schema = req.schema as
        | { properties?: Record<string, unknown>; required?: string[] }
        | undefined;
      const props = schema?.properties ?? {};
      const required = schema?.required ?? [];

      if (
        required.includes("acknowledgesBug") ||
        ("acknowledgesBug" in props && "asksForReproOrLogs" in props)
      ) {
        const scores: Record<string, unknown> = { rationale: "triage-stub" };
        for (const dim of required) {
          scores[dim] = 4;
        }
        for (const dim of Object.keys(props)) {
          if (dim === "rationale") continue;
          if (scores[dim] === undefined) scores[dim] = 4;
        }
        return {
          text: JSON.stringify(scores),
          provider: "gemini",
          model: "triage-stub-judge",
        };
      }

      const user = req.messages
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .join("\n");
      let item: Record<string, unknown> = {};
      const idx = user.lastIndexOf("Input:\n");
      if (idx >= 0) {
        try {
          item = JSON.parse(user.slice(idx + 7)) as Record<string, unknown>;
        } catch {
          item = {};
        }
      }
      return {
        text: JSON.stringify({
          text: `Thanks for reporting "${String(item.title ?? "issue")}". Can you share repro steps and expected vs actual? Next: label severity.`,
          issue_number: Number(item.number ?? 1),
        }),
        provider: "gemini",
        model: "triage-stub-draft",
      };
    },
  };
}

function githubFixtures(issues: unknown[]) {
  return [
    {
      service: "github",
      operation: "issuesListForRepo",
      body: issues,
    },
    {
      service: "github",
      operation: "issuesCreateComment",
      body: { id: 9001, body: "fixture comment" },
    },
  ];
}

function countOnceSkips(
  evidence: ReadonlyArray<{
    kind: string;
    stepId?: string;
    detail?: Record<string, unknown>;
  }>
): number {
  return evidence.filter(
    (e) =>
      e.kind === "skip" &&
      (e.stepId === "post" || e.stepId === "draft") &&
      e.detail?.reason === "once"
  ).length;
}

/** Count successful comment writes (exclude once-skips / failures). */
function countSuccessfulPosts(stepOutputs: Record<string, unknown>): number {
  const post = stepOutputs.post;
  const rows = Array.isArray(post) ? post : post ? [post] : [];
  return rows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const r = row as Record<string, unknown>;
    if (r.skipped === true) return false;
    if (r.error) return false;
    // Fixture or live API result
    return r.fixture === true || typeof r.status === "number" || r.body != null;
  }).length;
}

export async function runTriageColdDemo(options: {
  liveGithub?: boolean;
  demoRoot?: string;
} = {}): Promise<DemoResult> {
  const notes: string[] = [];
  const liveGithub = Boolean(options.liveGithub);
  const demoRoot = options.demoRoot ?? DEMO_ROOT;
  await rm(demoRoot, { recursive: true, force: true });
  await mkdir(demoRoot, { recursive: true });

  banner(1, "Intent");
  const intent = loadIntentText();
  console.log(intent.split("\n").slice(0, 6).join("\n") + "\n  …");
  notes.push("Loaded intent.md");

  banner(2, "Load + validate expected Spec");
  const services = loadCuratedServices().filter((s) => s.id === "github");
  if (!services.length) {
    throw new Error("Curated github descriptor missing from @relay/services");
  }
  const body = loadExpectedBody();
  const validation = validateSpecV2(body, {
    services,
    knownConnections: ["github:default"],
  });
  if (!validation.ok) {
    console.error(JSON.stringify(validation.errors, null, 2));
    throw new Error("spec.expected.yaml failed validation");
  }
  console.log("  validated against curated github + github:default");
  notes.push("Validated spec.expected.yaml (scaffold target locked)");

  // One Spec hash for shadow gate + live: freeze with dryRun false.
  // Shadow mode still forces host dryRun=true (simulated writes).
  const runBody: SpecV2Body = {
    ...body,
    budget: { ...body.budget, dryRun: false },
  };

  banner(3, "Freeze + Relay App bundle");
  const draft = createDraftSpecV2(runBody);
  const frozen = freezeSpecV2(draft, { frozenBy: "triage-cold-demo" });
  const bundle = buildRelayAppBundle({
    frozen,
    services,
    frozenBy: "triage-cold-demo",
  });
  const scheduleCount = listEnabledSchedules(bundle.lowered.manifest).length;
  console.log(`  specHash=${bundle.specHash.slice(0, 16)}…`);
  console.log(`  bundle=${bundle.id.slice(0, 20)}…`);
  console.log(`  schedules=${scheduleCount}`);
  notes.push("Frozen Spec + content-addressed bundle");

  const issues = loadIssuesFixture();
  const runStore = createFileRunStateStore(join(demoRoot, "runs"));
  // Durable once keys only for live ticks — shadow must not pollute draft once.
  const dataStore = createFileJsonDataStore({
    path: join(demoRoot, "spec-data.json"),
  });
  const token =
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    "";
  const connectionStore = createMemoryConnectionStore({
    "github:default": {
      type: "bearer",
      token: token || "triage-demo-fixture-token",
    },
  });
  const llm =
    (process.env.RELAY_TRIAGE_LIVE_LLM === "1"
      ? tryCreateLiveLlmClient()
      : null) ?? triageStubLlm();

  banner(4, liveGithub ? "Shadow run (live GitHub reads)" : "Shadow run (fixtures)");
  if (liveGithub && !token) {
    throw new Error("--live-github requires GITHUB_TOKEN or GH_TOKEN");
  }
  const shadow = await runSpec({
    body: runBody,
    frozen,
    services,
    connectionStore,
    llmClient: llm,
    mode: "shadow",
    blockNetwork: !liveGithub,
    apiFixtures: liveGithub ? undefined : githubFixtures(issues),
    hitl: {
      autoApprove: true,
      runStateStore: runStore,
    },
    name: "triage-shadow",
    frozenBy: "triage-cold-demo",
    context: {
      agentId: "triage-demo",
      userId: "operator",
      sessionId: `shadow-${Date.now()}`,
    },
    assertRunnable: false,
    softFailClosed: true,
  });
  if (shadow.state !== "COMPLETE" || !shadow.runId) {
    throw new Error(`Shadow run did not complete: ${shadow.state}`);
  }
  console.log(
    `  runId=${shadow.runId} evidence=${shadow.evidenceCount} simulatedWrites=${shadow.simulatedWriteCount}`
  );
  notes.push(
    liveGithub
      ? "Shadow complete (live reads, simulated writes)"
      : "Shadow complete (fixture reads, simulated writes)"
  );

  banner(5, "Approve evidence → enable schedule");
  await approveShadowEvidence(runStore, shadow.runId, {
    approvedBy: "triage-cold-demo",
    note: "Cold demo evidence pack",
  });
  const enabled = await enableSpecScheduler({
    body: runBody,
    dataDir: join(demoRoot, "scheduler"),
    runStateStore: runStore,
    approvedRunId: shadow.runId,
    name: "triage-live",
    invoke: async () => undefined,
  });
  console.log(
    `  schedule gate OK hash=${enabled.specHash.slice(0, 16)}… schedules=${scheduleCount}`
  );
  notes.push("Shadow gate passed; schedule enable unlocked");

  banner(6, "Live tick 1 (HITL auto-approve → post)");
  const tick1 = await runSpec({
    body: runBody,
    frozen,
    services,
    connectionStore,
    llmClient: llm,
    mode: "live",
    dryRun: false,
    blockNetwork: true,
    apiFixtures: githubFixtures(issues),
    dataStore,
    hitl: {
      autoApprove: true,
      runStateStore: runStore,
    },
    name: "triage-tick-1",
    frozenBy: "triage-cold-demo",
    context: {
      agentId: "triage-demo",
      userId: "operator",
      sessionId: `tick1-${Date.now()}`,
    },
    assertRunnable: false,
    softFailClosed: true,
  });
  if (tick1.state !== "COMPLETE") {
    throw new Error(`Tick 1 did not complete: ${tick1.state}`);
  }
  const tick1PostCount = countSuccessfulPosts(tick1.stepOutputs);
  console.log(`  posts=${tick1PostCount} (once keys committed)`);
  if (tick1PostCount < 1) {
    throw new Error("Expected ≥1 post on first live tick");
  }
  notes.push(`Tick 1 posted ${tick1PostCount} comment(s)`);

  banner(7, "Live tick 2 (once → no duplicate posts)");
  const tick2 = await runSpec({
    body: runBody,
    frozen,
    services,
    connectionStore,
    llmClient: llm,
    mode: "live",
    dryRun: false,
    blockNetwork: true,
    apiFixtures: githubFixtures(issues),
    dataStore,
    hitl: {
      autoApprove: true,
      runStateStore: runStore,
    },
    name: "triage-tick-2",
    frozenBy: "triage-cold-demo",
    context: {
      agentId: "triage-demo",
      userId: "operator",
      sessionId: `tick2-${Date.now()}`,
    },
    assertRunnable: false,
    softFailClosed: true,
  });
  if (tick2.state !== "COMPLETE") {
    throw new Error(`Tick 2 did not complete: ${tick2.state}`);
  }
  const tick2PostCount = countSuccessfulPosts(tick2.stepOutputs);
  const tick2OnceSkips = countOnceSkips(tick2.evidence);
  console.log(`  posts=${tick2PostCount} onceSkips=${tick2OnceSkips}`);
  if (tick2PostCount !== 0) {
    throw new Error(
      `Expected 0 successful posts on tick 2 (once), got ${tick2PostCount}`
    );
  }
  if (tick2OnceSkips < tick1PostCount) {
    throw new Error(
      `Expected ≥${tick1PostCount} once-skips on tick 2, got ${tick2OnceSkips}`
    );
  }
  notes.push(
    `Tick 2 once-skipped ${tick2OnceSkips}; zero duplicate comments`
  );

  console.log("\n=== triage cold demo OK ===");
  for (const n of notes) console.log(`  ✓ ${n}`);

  return {
    ok: true,
    mode: liveGithub ? "live-github" : "fixture",
    specHash: bundle.specHash,
    shadowRunId: shadow.runId,
    tick1PostCount,
    tick2PostCount,
    tick2OnceSkips,
    notes,
  };
}

async function main(): Promise<void> {
  const liveGithub = process.argv.includes("--live-github");
  console.log("=== Relay triage E2E cold demo ===");
  console.log(
    liveGithub
      ? "Mode: live GitHub reads (shadow) + fixture writes for idempotency ticks\n"
      : "Mode: offline fixtures + stub LLM (CI)\n"
  );
  try {
    await runTriageColdDemo({ liveGithub });
  } catch (err) {
    if (isSpecHostError(err)) {
      console.error(`FAIL [${err.code}] ${err.message}`);
    } else {
      console.error(err instanceof Error ? err.message : err);
    }
    process.exitCode = 1;
  }
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  void main();
}
