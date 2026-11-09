/**
 * Offline draft eval runner.
 *
 *   npm run eval:drafts              # stub drafts, deterministic scorers
 *   npm run eval:drafts -- --llm     # real draft LLM when API keys set
 *   npm run eval:drafts -- --judge   # also run advisory LLM judge
 *   npm run eval:drafts -- --strict-judge  # exit 1 if any judge score < 3
 *
 * Does not gate HITL approve / execute.
 */
import { createDraftLlmClient, draftLlmConfigured } from "../stages/draft/draft-llm.js";
import { draftReply } from "../stages/draft/drafter.js";
import { DRAFT_EVAL_CASES, type DraftEvalCase } from "../eval/draft-cases.js";
import { judgeDraft } from "../eval/draft-judge.js";
import { scoreDraft } from "../eval/draft-score.js";
import type { CommunityDraft } from "../types.js";

function parseArgs(argv: string[]): {
  llm: boolean;
  judge: boolean;
  strictJudge: boolean;
} {
  return {
    llm: argv.includes("--llm"),
    judge: argv.includes("--judge") || argv.includes("--strict-judge"),
    strictJudge: argv.includes("--strict-judge"),
  };
}

function caseToSkeleton(c: DraftEvalCase): CommunityDraft {
  return {
    id: `eval-${c.id}`,
    platform: "reddit",
    subreddit: c.subreddit,
    threadUrl: `https://reddit.com/r/${c.subreddit}/comments/eval/${c.id}`,
    threadTitle: c.threadTitle,
    kind: c.kind ?? "help",
    opText: c.opText,
    ...(c.opMediaHint ? { opMediaHint: c.opMediaHint } : {}),
    draftText: "",
    intensity: c.intensity ?? 0,
    score: {
      problemFit: true,
      wantsHelp: true,
      rulesOk: true,
      freshnessOk: true,
      valueWithoutApp: true,
      competition: true,
      icpFit: true,
      plugNaturalness: false,
    },
    rationale: `eval:${c.id}`,
    status: "proposed",
    createdAt: new Date().toISOString(),
  };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const savedGemini = process.env.GEMINI_API_KEY;
  const savedAnthropic = process.env.ANTHROPIC_API_KEY;
  if (!args.llm) {
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  } else if (!draftLlmConfigured()) {
    console.error(
      "[eval:drafts] --llm requested but no draft LLM API key is configured"
    );
    process.exit(2);
  }

  const judgeClient =
    args.judge && draftLlmConfigured()
      ? createDraftLlmClient()
      : args.judge
        ? null
        : undefined;
  if (args.judge && !judgeClient) {
    console.error(
      "[eval:drafts] --judge requested but no draft LLM API key is configured"
    );
    process.exit(2);
  }

  let failCount = 0;
  let warnCount = 0;
  let judgeFailCount = 0;

  console.log(
    `eval:drafts cases=${DRAFT_EVAL_CASES.length} mode=${args.llm ? "llm" : "stub"}` +
      (args.judge ? ` judge=on${args.strictJudge ? " strict" : ""}` : "")
  );
  console.log(
    `${pad("id", 24)} ${pad("ok", 4)} ${pad("prov", 8)} ${pad("model", 18)} findings`
  );

  for (const evalCase of DRAFT_EVAL_CASES) {
    const outcome = await draftReply(caseToSkeleton(evalCase), {
      forceIntensity0: evalCase.forceIntensity0,
      intensity: evalCase.intensity,
    });
    const scored = scoreDraft(outcome.draft, evalCase);
    if (!scored.ok) failCount += 1;
    warnCount += scored.findings.filter((f) => f.severity === "warn").length;

    let judgeNote = "";
    if (judgeClient) {
      try {
        const j = await judgeDraft({
          client: judgeClient,
          evalCase,
          draft: outcome.draft,
        });
        judgeNote = ` judge=${j.threadFit}/${j.soundsHuman}/${j.specificity}`;
        if (
          args.strictJudge &&
          (j.threadFit < 3 || j.soundsHuman < 3 || j.specificity < 3)
        ) {
          judgeFailCount += 1;
          judgeNote += " FAIL";
        }
      } catch (err) {
        judgeFailCount += 1;
        const message = err instanceof Error ? err.message : String(err);
        judgeNote = ` judge=error(${message})`;
      }
    }

    const findingText =
      scored.findings.map((f) => `${f.severity}:${f.id}`).join(",") || "—";
    console.log(
      `${pad(evalCase.id, 24)} ${pad(scored.ok ? "ok" : "FAIL", 4)} ` +
        `${pad(outcome.provider, 8)} ${pad(outcome.draft.draftModel ?? "—", 18)} ` +
        `${findingText}${judgeNote}`
    );
    if (!scored.ok) {
      for (const f of scored.findings.filter((x) => x.severity === "fail")) {
        console.log(`  - ${f.message}`);
      }
    }
  }

  if (savedGemini !== undefined) process.env.GEMINI_API_KEY = savedGemini;
  else delete process.env.GEMINI_API_KEY;
  if (savedAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = savedAnthropic;
  else delete process.env.ANTHROPIC_API_KEY;

  console.log(
    `\nsummary: fail=${failCount} warn=${warnCount}` +
      (args.judge ? ` judgeFail=${judgeFailCount}` : "")
  );

  const exitFail =
    failCount > 0 || (args.strictJudge && judgeFailCount > 0);
  process.exit(exitFail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
