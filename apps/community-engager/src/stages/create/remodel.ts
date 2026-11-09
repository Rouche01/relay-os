import {
  createLlmClient,
  parseLlmProviderId,
  resolveAnthropicApiKey,
  resolveGeminiApiKey,
  type LlmClient,
  type LlmProviderId,
} from "@relay/llm";
import type { CreateProposal } from "../../types.js";
import type { WinnerCandidate } from "./winner-scout.js";

const TITLE_MAX = 280;
const BODY_MAX = 8_000;
const SOURCE_BODY_MAX = 1_200;

export interface RemodelResult {
  proposal: CreateProposal;
  provider: "gemini" | "anthropic" | "stub";
  model: string;
}

const PATTERN_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    patternSummary: {
      type: "string",
      description: "One-line pattern (structure, not copied text).",
    },
    angle: { type: "string" },
    structureHints: { type: "string" },
    avoidCopying: { type: "string" },
    title: { type: "string" },
    body: { type: "string" },
    rationale: { type: "string" },
  },
  required: ["patternSummary", "title", "body"],
};

/**
 * Extract a pattern from winners and remodel into an original title+body.
 * Uses COMMUNITY_DRAFT_LLM when keyed; otherwise a deterministic stub.
 */
export async function remodelWinnersToProposal(
  winners: WinnerCandidate[],
  opts?: { nowMs?: number; client?: LlmClient }
): Promise<RemodelResult | null> {
  if (winners.length === 0) return null;
  const primary = winners[0]!;
  const subreddit = primary.subreddit;
  const now = opts?.nowMs ?? Date.now();
  const id = `create-${subreddit.toLowerCase()}-${now}`;

  const sources = winners.map((w) => ({
    title: w.post.title,
    body: (w.post.selftext ?? "").slice(0, SOURCE_BODY_MAX),
    permalink: w.post.permalink,
    name: w.post.name || `t3_${w.post.id}`,
  }));

  if (opts?.client || remodelLlmConfigured()) {
    try {
      const client = opts?.client ?? createRemodelLlmClient();
      const parsed = await generateRemodelViaLlm(client, sources, subreddit);
      const provider =
        parsed.provider === "anthropic" ? "anthropic" : "gemini";
      return {
        provider,
        model: parsed.model,
        proposal: {
          id,
          kind: "create",
          platform: "reddit",
          subreddit,
          title: clamp(parsed.title, TITLE_MAX),
          body: clamp(parsed.body, BODY_MAX),
          patternSummary: clamp(parsed.patternSummary, 400),
          sourcePostIds: sources.map((s) => s.name),
          sourcePermalinks: sources.map((s) => s.permalink),
          status: "proposed",
          createdAt: new Date(now).toISOString(),
          draftProvider: provider,
          draftModel: parsed.model,
          rationale: parsed.rationale,
        },
      };
    } catch (err) {
      console.warn("[create] remodel LLM failed; using stub:", err);
    }
  }

  const stub = stubRemodel(sources, subreddit);
  return {
    provider: "stub",
    model: "stub",
    proposal: {
      id,
      kind: "create",
      platform: "reddit",
      subreddit,
      title: stub.title,
      body: stub.body,
      patternSummary: stub.patternSummary,
      sourcePostIds: sources.map((s) => s.name),
      sourcePermalinks: sources.map((s) => s.permalink),
      status: "proposed",
      createdAt: new Date(now).toISOString(),
      draftProvider: "stub",
      draftModel: "stub",
      rationale: stub.rationale,
    },
  };
}

export function stubRemodel(
  sources: Array<{ title: string; body: string }>,
  subreddit: string
): {
  patternSummary: string;
  title: string;
  body: string;
  rationale: string;
} {
  const seed = sources[0]?.title ?? "outfit lesson";
  const patternSummary =
    "First-person fit/check lesson: one concrete regret + one tip (do not copy source wording).";
  const title = `What I got wrong about ${truncateSeed(seed)}`;
  const body =
    `I kept seeing threads like this in r/${subreddit} and finally wrote down what changed for me.\n\n` +
    `**What I used to do:** chase trends without a base layer plan.\n\n` +
    `**What works better:** pick one silhouette, repeat it with small variations, and stop buying "almost" pieces.\n\n` +
    `Curious if anyone else rebuilt their rotation this way — what stuck for you?`;
  return {
    patternSummary,
    title: clamp(title, TITLE_MAX),
    body: clamp(body, BODY_MAX),
    rationale: "Stub remodel from winner titles (no LLM key).",
  };
}

function truncateSeed(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length <= 48) return t.toLowerCase();
  return `${t.slice(0, 45).toLowerCase()}…`;
}

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function resolveRemodelProvider(
  env: NodeJS.ProcessEnv = process.env
): LlmProviderId {
  return parseLlmProviderId(env.COMMUNITY_DRAFT_LLM, "gemini");
}

export function remodelLlmConfigured(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const p = resolveRemodelProvider(env);
  if (p === "anthropic") {
    return Boolean(resolveAnthropicApiKey(env.ANTHROPIC_API_KEY));
  }
  return Boolean(
    resolveGeminiApiKey(env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY)
  );
}

function createRemodelLlmClient(
  env: NodeJS.ProcessEnv = process.env
): LlmClient {
  const provider = resolveRemodelProvider(env);
  const apiKey =
    provider === "anthropic"
      ? resolveAnthropicApiKey(env.ANTHROPIC_API_KEY)
      : resolveGeminiApiKey(env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY);
  if (!apiKey) {
    throw new Error(
      provider === "anthropic" ? "ANTHROPIC_API_KEY unset" : "GEMINI_API_KEY unset"
    );
  }
  return createLlmClient({ provider, apiKey });
}

async function generateRemodelViaLlm(
  client: LlmClient,
  sources: Array<{ title: string; body: string; permalink: string }>,
  subreddit: string
): Promise<{
  patternSummary: string;
  title: string;
  body: string;
  rationale?: string;
  provider: LlmProviderId;
  model: string;
}> {
  const sourceBlock = sources
    .map(
      (s, i) =>
        `### Source ${i + 1}\nTitle: ${s.title}\nURL: ${s.permalink}\nBody:\n${s.body || "(link/image post)"}`
    )
    .join("\n\n");

  const prompt =
    `You remodel winning Reddit fashion posts into ORIGINAL proposals. ` +
    `Never copy titles or sentences. Extract structure only. ` +
    `Voice: first-person, concrete, no product plugs, no links.\n\n` +
    `Subreddit: r/${subreddit}\n\n` +
    `Winning posts to learn from (do not copy):\n${sourceBlock}\n\n` +
    `Produce patternSummary, title, and body for a new top-level post.`;

  const result = await client.completeJson({
    messages: [{ role: "user", content: prompt }],
    schema: PATTERN_SCHEMA,
    temperature: 0.5,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(result.text) as Record<string, unknown>;
  } catch {
    throw new Error("remodel JSON parse failed");
  }

  const patternSummary = String(parsed.patternSummary ?? "").trim();
  const title = String(parsed.title ?? "").trim();
  const body = String(parsed.body ?? "").trim();
  if (!patternSummary || !title || !body) {
    throw new Error("remodel JSON missing required fields");
  }
  return {
    patternSummary,
    title,
    body,
    rationale: parsed.rationale ? String(parsed.rationale) : undefined,
    provider: result.provider,
    model: result.model,
  };
}
