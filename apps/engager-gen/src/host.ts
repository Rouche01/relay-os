/**
 * engager-gen host — bootstrap only (no stage handlers).
 * Pipeline: (optional scaffold from intent) → @relay/spec-host runSpec
 * (validate → freeze → lower → evals → dry-run HITL).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ApiFixture } from "@relay/engines-api";
import type { LlmClient, LlmJsonRequest, LlmJsonResult } from "@relay/llm";
import { messageText } from "@relay/llm";
import {
  parseServiceDescriptorYaml,
  type SpecV2Body,
} from "@relay/protocol";
import type { EvalCase } from "@relay/spec-evals";
import { createMemoryConnectionStore, runSpec } from "@relay/spec-host";
import { scaffoldSpec } from "@relay/spec-scaffold";
import { parseSpecV2Yaml, validateSpecV2 } from "@relay/spec-validator";

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

export type EngagerGenResult = {
  specId: string;
  specHash: string;
  state: string;
  evidenceCount: number;
  draftCount: number;
  evalPassed: boolean;
  source: "yaml" | "scaffold";
  scaffoldAttempts?: number;
};

type FixtureThread = {
  id: string;
  subreddit: string;
  threadTitle: string;
  opText: string;
  threadUrl: string;
};

function loadText(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function loadJson<T>(rel: string): T {
  return JSON.parse(loadText(rel)) as T;
}

function loadServices() {
  return [
    parseServiceDescriptorYaml(loadText("services/reddit-public.yaml")),
    parseServiceDescriptorYaml(loadText("services/reddit-oauth.yaml")),
  ];
}

/** Allowlisted posts only — OUTFITS stays in the file for negative evals. */
function scoutPosts(threads: FixtureThread[]): FixtureThread[] {
  const allow = new Set(["malefashionadvice", "femalefashionadvice"]);
  return threads.filter((t) => allow.has(t.subreddit));
}

/** Deterministic stub — offline CI; swap for createLlmClient when parity-running. */
export function createStubLlmClient(): LlmClient {
  return {
    provider: "gemini",
    async completeJson(req: LlmJsonRequest): Promise<LlmJsonResult> {
      const props =
        req.schema &&
        typeof req.schema === "object" &&
        req.schema.properties &&
        typeof req.schema.properties === "object"
          ? (req.schema.properties as Record<string, unknown>)
          : {};

      if ("threadFit" in props || "soundsHuman" in props) {
        const scores: Record<string, unknown> = {
          rationale: "stub judge: solid fixture draft",
        };
        for (const key of Object.keys(props)) {
          if (key === "rationale") continue;
          scores[key] = 4;
        }
        return {
          text: JSON.stringify(scores),
          provider: "gemini",
          model: "engager-gen-stub",
        };
      }

      if ("label" in props) {
        return {
          text: JSON.stringify({
            label: "answerable",
            confidence: 0.9,
            rationale: "stub",
          }),
          provider: "gemini",
          model: "engager-gen-stub",
        };
      }

      const user = req.messages.map((m) => messageText(m.content)).join("\n");
      let item: Record<string, unknown> = {};
      const inputIdx = user.lastIndexOf("Input:\n");
      if (inputIdx >= 0) {
        try {
          item = JSON.parse(user.slice(inputIdx + "Input:\n".length)) as Record<
            string,
            unknown
          >;
        } catch {
          item = {};
        }
      }
      const rawId = String(item.id ?? "t3_unknown");
      const thing_id = rawId.startsWith("t3_") ? rawId : `t3_${rawId}`;
      const title = String(item.threadTitle ?? "the thread");
      return {
        text: JSON.stringify({
          text: `For "${title}": pick one versatile base layer and build two outfits around it before buying more. Skip trends that need three new SKUs.`,
          thing_id,
        }),
        provider: "gemini",
        model: "engager-gen-stub",
      };
    },
  };
}

function evalCases(): EvalCase[] {
  return [
    {
      id: "good_draft",
      stepId: "draft",
      output: {
        text: "Pick one versatile base layer and build two outfits around it.",
        thing_id: "t3_fx_capsule",
      },
      scope: {
        draft: {
          text: "Pick one versatile base layer and build two outfits around it.",
        },
        item: { subreddit: "femalefashionadvice" },
      },
      rules: ["no_promo_links", "allowlist_only"],
    },
    {
      id: "bad_promo",
      description: "Deliberately bad draft with a link must be blocked",
      stepId: "draft",
      output: { text: "Buy this https://spam.example/fit", thing_id: "t3_x" },
      scope: {
        draft: { text: "Buy this https://spam.example/fit" },
        item: { subreddit: "malefashionadvice" },
      },
      rules: ["no_promo_links"],
      expect: { rules: { no_promo_links: false } },
    },
    {
      id: "bad_subreddit",
      output: { text: "nice haul", thing_id: "t3_fx_haul" },
      scope: {
        draft: { text: "nice haul" },
        item: { subreddit: "OUTFITS" },
      },
      rules: ["allowlist_only"],
      expect: { rules: { allowlist_only: false } },
    },
  ];
}

/**
 * Offline scaffold stub: returns the checked-in Spec as JSON so CI proves
 * intent → scaffold → validate without a live LLM. Swap for createLlmClient
 * when dogfooding generation quality.
 */
export function createScaffoldStubClient(
  body: SpecV2Body,
  options?: { failFirst?: boolean }
): LlmClient {
  let calls = 0;
  return {
    provider: "gemini",
    async completeJson(): Promise<LlmJsonResult> {
      calls += 1;
      if (options?.failFirst && calls === 1) {
        const bad = structuredClone(body);
        bad.steps = bad.steps.map((s, i) =>
          i === 0 ? { ...s, use: "llm.invent" } : s
        );
        return {
          text: JSON.stringify(bad),
          provider: "gemini",
          model: "engager-gen-scaffold-stub",
        };
      }
      return {
        text: JSON.stringify(body),
        provider: "gemini",
        model: "engager-gen-scaffold-stub",
      };
    },
  };
}

export async function runEngagerGen(options?: {
  autoApprove?: boolean;
  /**
   * When true, scaffold Spec from intent.md (stub LLM) instead of reading
   * spec.yaml. Still uses the hand-written Spec as the stub oracle so the
   * pipeline is proven offline; live LLM is optional for dogfood.
   */
  fromIntent?: boolean;
}): Promise<EngagerGenResult> {
  const autoApprove = options?.autoApprove ?? true;
  const fromIntent = options?.fromIntent ?? false;
  const intent = loadText("intent.md");
  const services = loadServices();
  const threads = loadJson<FixtureThread[]>("fixtures/threads.json");
  const posts = scoutPosts(threads);
  const referenceBody = parseSpecV2Yaml(loadText("spec.yaml"));

  let body: SpecV2Body;
  let source: "yaml" | "scaffold" = "yaml";
  let scaffoldAttempts: number | undefined;

  if (fromIntent) {
    const scaffolded = await scaffoldSpec({
      intent,
      client: createScaffoldStubClient(referenceBody, { failFirst: true }),
      services,
      knownConnections: ["reddit:default"],
      maxRepairs: 3,
    });
    if (!scaffolded.ok) {
      throw new Error(
        `Scaffold failed:\n${scaffolded.message}\n${scaffolded.errors
          .map((e) => `- [${e.code}] ${e.message}`)
          .join("\n")}`
      );
    }
    body = scaffolded.body;
    source = "scaffold";
    scaffoldAttempts = scaffolded.attempts;
  } else {
    body = referenceBody;
  }

  const validation = validateSpecV2(body, {
    services,
    knownConnections: ["reddit:default"],
  });
  if (!validation.ok) {
    throw new Error(
      `Spec validation failed:\n${validation.errors
        .map((e) => `- [${e.code}] ${e.message}`)
        .join("\n")}`
    );
  }

  const apiFixtures: ApiFixture[] = [
    {
      service: "reddit-public",
      operation: "listNew",
      body: { posts },
    },
  ];

  const result = await runSpec({
    body,
    services,
    connectionStore: createMemoryConnectionStore({
      "reddit:default": { type: "bearer", token: "dry-run-token" },
    }),
    llmClient: createStubLlmClient(),
    mode: "fixture",
    dryRun: true,
    blockNetwork: true,
    apiFixtures,
    hitl: { autoApprove },
    evals: { cases: evalCases(), softFailClosed: false },
    name: "engager-gen",
    frozenBy: "engager-gen-host",
    draftId: "specv2_engager_gen_lite",
    intentId: "intent_engager_gen_lite",
    context: {
      agentId: "engager-gen-1",
      userId: "operator",
      sessionId: `engager-gen-${Date.now()}`,
      intentPreview: intent.slice(0, 200),
    },
    assertRunnable: { validate: false },
    softFailClosed: true,
  });

  const drafts = result.stepOutputs.draft;
  const draftCount = Array.isArray(drafts) ? drafts.length : 0;

  return {
    specId: result.specId,
    specHash: result.specHash,
    state: result.state,
    evidenceCount: result.evidenceCount,
    draftCount,
    evalPassed: result.evalReport?.passed ?? false,
    source,
    scaffoldAttempts,
  };
}

async function main(): Promise<void> {
  const fromIntent =
    process.argv.includes("--from-intent") ||
    process.env.ENGAGER_GEN_FROM_INTENT === "1";
  console.log(
    `[engager-gen] ${fromIntent ? "scaffold → " : ""}spec-host runSpec (fixture)`
  );
  const result = await runEngagerGen({ autoApprove: true, fromIntent });
  console.log(
    JSON.stringify(
      {
        ...result,
        note: "See PARITY.md for CE comparison hooks",
      },
      null,
      2
    )
  );
  if (result.state !== "COMPLETE") {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
