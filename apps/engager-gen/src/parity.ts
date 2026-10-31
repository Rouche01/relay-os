/**
 * Live-LLM / stub parity vs CommunityEngager (PARITY.md).
 *
 * - Draft soft-judge: mean |gen − ce| ≤ 0.5 on shared fixtures
 * - Scaffold success rate over N intents (recorded; live when keys set)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LlmClient, LlmJsonRequest, LlmJsonResult } from "@relay/llm";
import type { SpecV2Body } from "@relay/protocol";
import { tryCreateLiveLlmClient } from "@relay/spec-host";
import { scaffoldSpec } from "@relay/spec-scaffold";
import { parseSpecV2Yaml, validateSpecV2 } from "@relay/spec-validator";
import {
  curatedKnownConnections,
  loadCuratedServices,
} from "@relay/services";
import { createStubLlmClient } from "./host.js";
import {
  judgeDraft,
  meanJudgeScore,
  type DraftJudgeScores,
  type ParityDraftCase,
} from "./draft-judge.js";

/** Pass when |mean(gen) − mean(ce)| ≤ this (PARITY.md). */
export const PARITY_MAX_MEAN_DELTA = 0.5;

function packageRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (
      existsSync(join(dir, "package.json")) &&
      (existsSync(join(dir, "spec.yaml")) || existsSync(join(dir, "intent.md")))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("engager-gen package root not found");
    }
    dir = parent;
  }
}

const ROOT = packageRoot(__dirname);

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as T;
}

export type DraftParityRow = {
  id: string;
  genMean: number;
  ceMean: number;
  delta: number;
  gen: DraftJudgeScores;
  ce: DraftJudgeScores;
};

export type ScaffoldParityRow = {
  id: string;
  ok: boolean;
  expectOk: boolean;
  matchedExpectation: boolean;
  attempts?: number;
  error?: string;
};

export type ParityReport = {
  mode: "stub" | "live";
  judgedAt: string;
  maxMeanDelta: number;
  draft: {
    rows: DraftParityRow[];
    genMean: number;
    ceMean: number;
    meanDelta: number;
    passed: boolean;
  };
  scaffold: {
    total: number;
    ok: number;
    rate: number;
    matchedExpectation: number;
    rows: ScaffoldParityRow[];
  };
  passed: boolean;
};

type IntentFixture = {
  id: string;
  intent: string;
  expectOk: boolean;
};

/**
 * Scaffold stub that returns the CE-lite Spec only for fashion-like intents;
 * otherwise returns an invalid Spec so offline success rate is informative.
 */
/** Pull only the ## Intent block so catalog text does not false-positive. */
function intentFromScaffoldPrompt(req: LlmJsonRequest): string {
  const user = req.messages
    .map((m) =>
      typeof m.content === "string" ? m.content : JSON.stringify(m.content)
    )
    .join("\n");
  const m = /## Intent\n([\s\S]*?)(?:\n## |\n#|$)/i.exec(user);
  return (m?.[1] ?? user).trim().toLowerCase();
}

export function createParityScaffoldClient(
  fashionBody: SpecV2Body
): LlmClient {
  return {
    provider: "gemini",
    async completeJson(req: LlmJsonRequest): Promise<LlmJsonResult> {
      const intent = intentFromScaffoldPrompt(req);
      const fashion =
        intent.includes("fashion") ||
        intent.includes("subreddit") ||
        intent.includes("malefashion") ||
        intent.includes("femalefashion");
      if (fashion) {
        return {
          text: JSON.stringify(fashionBody),
          provider: "gemini",
          model: "parity-scaffold-stub",
        };
      }
      return {
        text: JSON.stringify({
          goal: "broken",
          steps: [{ id: "x", use: "magic.teleport" }],
        }),
        provider: "gemini",
        model: "parity-scaffold-stub",
      };
    },
  };
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export async function runDraftParity(options: {
  client: LlmClient;
  cases?: ParityDraftCase[];
}): Promise<ParityReport["draft"]> {
  const cases =
    options.cases ?? loadJson<ParityDraftCase[]>("fixtures/parity-cases.json");
  const rows: DraftParityRow[] = [];
  for (const c of cases) {
    const gen = await judgeDraft({
      client: options.client,
      evalCase: c,
      draftText: c.genDraft,
    });
    const ce = await judgeDraft({
      client: options.client,
      evalCase: c,
      draftText: c.ceDraft,
    });
    const genMean = meanJudgeScore(gen);
    const ceMean = meanJudgeScore(ce);
    rows.push({
      id: c.id,
      genMean,
      ceMean,
      delta: Math.abs(genMean - ceMean),
      gen,
      ce,
    });
  }
  const genMean = avg(rows.map((r) => r.genMean));
  const ceMean = avg(rows.map((r) => r.ceMean));
  const meanDelta = Math.abs(genMean - ceMean);
  return {
    rows,
    genMean,
    ceMean,
    meanDelta,
    passed: meanDelta <= PARITY_MAX_MEAN_DELTA,
  };
}

export async function runScaffoldParity(options: {
  client: LlmClient;
  intents?: IntentFixture[];
}): Promise<ParityReport["scaffold"]> {
  const intents =
    options.intents ??
    loadJson<IntentFixture[]>("fixtures/parity-intents.json");
  const services = loadCuratedServices();
  const knownConnections = curatedKnownConnections();
  const rows: ScaffoldParityRow[] = [];

  for (const row of intents) {
    try {
      const scaffolded = await scaffoldSpec({
        intent: row.intent,
        client: options.client,
        services,
        knownConnections,
        maxRepairs: 3,
      });
      const ok =
        scaffolded.ok &&
        validateSpecV2(scaffolded.body, { services, knownConnections }).ok;
      rows.push({
        id: row.id,
        ok,
        expectOk: row.expectOk,
        matchedExpectation: ok === row.expectOk,
        attempts: scaffolded.ok ? scaffolded.attempts : undefined,
        error: scaffolded.ok
          ? undefined
          : scaffolded.message.slice(0, 160),
      });
    } catch (err) {
      rows.push({
        id: row.id,
        ok: false,
        expectOk: row.expectOk,
        matchedExpectation: row.expectOk === false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const ok = rows.filter((r) => r.ok).length;
  return {
    total: rows.length,
    ok,
    rate: rows.length ? ok / rows.length : 0,
    matchedExpectation: rows.filter((r) => r.matchedExpectation).length,
    rows,
  };
}

export async function runParityReport(options?: {
  /** Force stub even when live keys exist. */
  stub?: boolean;
  writeResultsPath?: string;
}): Promise<ParityReport> {
  const live = options?.stub ? null : tryCreateLiveLlmClient();
  const mode: "stub" | "live" = live ? "live" : "stub";
  const referenceBody = parseSpecV2Yaml(
    readFileSync(join(ROOT, "spec.yaml"), "utf8")
  );

  const judgeClient = live ?? createStubLlmClient();
  const scaffoldClient =
    live ?? createParityScaffoldClient(referenceBody);

  const draft = await runDraftParity({ client: judgeClient });
  const scaffold = await runScaffoldParity({ client: scaffoldClient });

  const report: ParityReport = {
    mode,
    judgedAt: new Date().toISOString(),
    maxMeanDelta: PARITY_MAX_MEAN_DELTA,
    draft,
    scaffold,
    // Offline pass: draft delta gate + scaffold rows match expectOk flags.
    passed:
      draft.passed &&
      scaffold.matchedExpectation === scaffold.total &&
      scaffold.total > 0,
  };

  const outPath =
    options?.writeResultsPath ?? join(ROOT, "parity-results.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  return report;
}

async function main(): Promise<void> {
  const stub =
    process.argv.includes("--stub") ||
    process.env.RELAY_PARITY_STUB === "1";
  console.log(`[engager-gen parity] mode=${stub ? "stub (forced)" : "auto"}`);
  const report = await runParityReport({ stub });
  console.log(
    JSON.stringify(
      {
        mode: report.mode,
        passed: report.passed,
        draft: {
          genMean: report.draft.genMean,
          ceMean: report.draft.ceMean,
          meanDelta: report.draft.meanDelta,
          maxAllowed: report.maxMeanDelta,
          passed: report.draft.passed,
        },
        scaffold: {
          rate: report.scaffold.rate,
          ok: report.scaffold.ok,
          total: report.scaffold.total,
          matchedExpectation: report.scaffold.matchedExpectation,
        },
        resultsFile: join(ROOT, "parity-results.json"),
      },
      null,
      2
    )
  );
  if (!report.passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
