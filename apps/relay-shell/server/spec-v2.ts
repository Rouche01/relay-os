/**
 * Spec v2 host API for Relay Desk — scaffold / validate / lower / evals / freeze / run.
 * No compiler inside Tauri; Desk calls these HTTP endpoints.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiEngine } from "@relay/engines-api";
import { createDataEngine } from "@relay/engines-data";
import { createLlmEngine } from "@relay/engines-llm";
import { createLlmClient, parseLlmProviderId, type LlmClient } from "@relay/llm";
import {
  AgentRuntimeEvent,
  createDraftSpecV2,
  freezeSpecV2,
  parseServiceDescriptorYaml,
  type SpecV2Body,
} from "@relay/protocol";
import { assertEvalsGate, compileEvals, runEvals } from "@relay/spec-evals";
import { lowerSpecV2 } from "@relay/spec-lower";
import { scaffoldSpec, specBodyToYaml } from "@relay/spec-scaffold";
import { parseSpecV2Yaml, validateSpecV2 } from "@relay/spec-validator";
import {
  createWorkflowRuntime,
  getEvidence,
} from "@relay/workflow-runtime";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

function loadProtocolService(name: string) {
  const p = join(repoRoot, "packages/protocol/services", name);
  if (!existsSync(p)) {
    throw new Error(`Missing service descriptor: ${p}`);
  }
  return parseServiceDescriptorYaml(readFileSync(p, "utf8"));
}

let cachedServices: ReturnType<typeof loadProtocolService>[] | null = null;

export function loadV2Services() {
  if (!cachedServices) {
    cachedServices = [
      loadProtocolService("reddit-public.yaml"),
      loadProtocolService("reddit-oauth.yaml"),
    ];
  }
  return cachedServices;
}

/** CE-lite template used when no LLM key (offline Desk demo). */
export function stubSpecFromIntent(intent: string): SpecV2Body {
  const goal =
    intent
      .split("\n")
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find((l) => l.length > 0) ||
    "Help people in allowlisted fashion subreddits with genuinely useful replies";

  return {
    goal,
    connections: ["reddit:default"],
    services: ["reddit-public", "reddit-oauth"],
    budget: { maxJobs: 2, dryRun: true },
    rules: [
      {
        id: "allowlist_only",
        kind: "hard",
        check: {
          in: "${item.subreddit}",
          list: ["malefashionadvice", "femalefashionadvice"],
        },
      },
      {
        id: "no_promo_links",
        kind: "hard",
        check: { notMatches: "${draft.text}", pattern: "https?://" },
      },
      {
        id: "helpful_reply",
        kind: "soft",
        judge: {
          rubric: ["threadFit", "soundsHuman", "specificity"],
          minMean: 3.5,
        },
      },
      {
        id: "earns_engagement",
        kind: "outcome",
        metric: { name: "comment_score", after: "48h", min: 2 },
      },
    ],
    steps: [
      {
        id: "scout",
        use: "api.request",
        args: {
          service: "reddit-public",
          operation: "listNew",
          params: { subreddit: "malefashionadvice", limit: 10 },
        },
        outputs: ["posts"],
      },
      {
        id: "draft",
        use: "llm.generate",
        forEach: "${steps.scout.output.body.posts}",
        args: {
          prompt:
            "Draft a short, helpful fashion reply. Be concrete. No links or promo. Return JSON with text and thing_id.",
          input: "${item}",
          schema: {
            type: "object",
            properties: {
              text: { type: "string" },
              thing_id: { type: "string" },
            },
            required: ["text", "thing_id"],
          },
        },
        enforce: ["no_promo_links", "allowlist_only", "helpful_reply"],
      },
      {
        id: "approve",
        use: "human.approve",
        args: {
          show: "${steps.draft.output}",
          prompt: "Approve drafts before dry-run post?",
        },
      },
      {
        id: "post",
        use: "api.request",
        forEach: "${steps.draft.output}",
        args: {
          service: "reddit-oauth",
          operation: "comment",
          connection: "reddit:default",
          method: "POST",
          params: {
            thing_id: "${item.thing_id}",
            text: "${item.text}",
            api_type: "json",
          },
        },
      },
      {
        id: "learn",
        use: "data.append",
        args: { store: "outcomes", value: "${steps.post.output}" },
      },
    ],
  };
}

function resolveBody(input: {
  yaml?: string;
  body?: SpecV2Body;
}): SpecV2Body {
  if (input.body) return input.body;
  if (input.yaml?.trim()) return parseSpecV2Yaml(input.yaml);
  throw new Error("Provide yaml or body");
}

function tryLiveLlmClient(): LlmClient | null {
  const forceStub =
    process.env.RELAY_SPEC_SCAFFOLD_STUB === "1" ||
    process.env.RELAY_SPEC_SCAFFOLD_STUB === "true";
  if (forceStub) return null;
  try {
    const provider = parseLlmProviderId(process.env.LLM_PROVIDER);
    return createLlmClient({ provider });
  } catch {
    return null;
  }
}

function runtimeStubLlm(): LlmClient {
  return {
    provider: "gemini",
    async completeJson(req) {
      const props =
        req.schema &&
        typeof req.schema === "object" &&
        (req.schema as { properties?: Record<string, unknown> }).properties
          ? ((req.schema as { properties: Record<string, unknown> }).properties)
          : {};
      if ("threadFit" in props || "soundsHuman" in props) {
        const scores: Record<string, unknown> = { rationale: "stub" };
        for (const k of Object.keys(props)) {
          if (k !== "rationale") scores[k] = 4;
        }
        return {
          text: JSON.stringify(scores),
          provider: "gemini",
          model: "desk-stub",
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
      const rawId = String(item.id ?? "t3_desk");
      const thing_id = rawId.startsWith("t3_") ? rawId : `t3_${rawId}`;
      return {
        text: JSON.stringify({
          text: `Concrete tip for "${String(item.threadTitle ?? "the thread")}": one versatile base layer, two outfits — no links.`,
          thing_id,
        }),
        provider: "gemini",
        model: "desk-stub",
      };
    },
  };
}

export async function handleScaffold(input: {
  intent?: string;
  stub?: boolean;
}) {
  const intent = String(input.intent ?? "").trim();
  if (!intent) {
    return { ok: false as const, status: 400, error: "intent required" };
  }
  const services = loadV2Services();
  const live = input.stub === true ? null : tryLiveLlmClient();

  if (!live) {
    const body = stubSpecFromIntent(intent);
    const validation = validateSpecV2(body, {
      services,
      knownConnections: ["reddit:default"],
    });
    return {
      ok: true as const,
      status: 200,
      mode: "stub" as const,
      body,
      yaml: specBodyToYaml(body),
      validation,
      attempts: 1,
    };
  }

  const result = await scaffoldSpec({
    intent,
    client: live,
    services,
    knownConnections: ["reddit:default"],
    maxRepairs: 3,
  });
  if (!result.ok) {
    return {
      ok: false as const,
      status: 422,
      mode: "llm" as const,
      error: result.message,
      errors: result.errors,
      yaml: result.yaml,
      attempts: result.attempts,
    };
  }
  return {
    ok: true as const,
    status: 200,
    mode: "llm" as const,
    body: result.body,
    yaml: result.yaml,
    validation: result.validation,
    attempts: result.attempts,
  };
}

export function handleValidate(input: { yaml?: string; body?: SpecV2Body }) {
  const body = resolveBody(input);
  const validation = validateSpecV2(body, {
    services: loadV2Services(),
    knownConnections: ["reddit:default"],
  });
  return {
    ok: validation.ok,
    status: 200,
    body,
    yaml: specBodyToYaml(body),
    validation,
  };
}

export function handleLower(input: { yaml?: string; body?: SpecV2Body }) {
  const body = resolveBody(input);
  const validation = validateSpecV2(body, {
    services: loadV2Services(),
    knownConnections: ["reddit:default"],
  });
  if (!validation.ok) {
    return {
      ok: false as const,
      status: 422,
      error: "Spec invalid — fix before lower",
      validation,
    };
  }
  const lowered = lowerSpecV2(body, { name: "desk-workflow" });
  return {
    ok: true as const,
    status: 200,
    specHash: lowered.specHash,
    manifest: lowered.manifest,
    relay: lowered.relay,
    yaml: specBodyToYaml(body),
  };
}

export async function handleEvals(input: { yaml?: string; body?: SpecV2Body }) {
  const body = resolveBody(input);
  const compiled = compileEvals(body);
  const report = await runEvals({
    spec: body,
    softFailClosed: false,
    llmEngine: createLlmEngine({ client: runtimeStubLlm() }),
    fixtures: {
      cases: [
        {
          id: "good_draft",
          rules: ["no_promo_links", "allowlist_only"].filter((id) =>
            (body.rules ?? []).some((r) => r.id === id)
          ),
          output: { text: "Pick one versatile base layer." },
          scope: {
            draft: { text: "Pick one versatile base layer." },
            item: { subreddit: "malefashionadvice" },
          },
        },
        {
          id: "bad_promo",
          rules: ["no_promo_links"].filter((id) =>
            (body.rules ?? []).some((r) => r.id === id)
          ),
          output: { text: "see https://spam.example" },
          scope: {
            draft: { text: "see https://spam.example" },
            item: { subreddit: "malefashionadvice" },
          },
          expect: { rules: { no_promo_links: false } },
        },
      ].filter((c) => (c.rules?.length ?? 0) > 0),
    },
  });
  return {
    ok: report.passed,
    status: 200,
    compiled,
    report,
  };
}

export function handleFreeze(input: { yaml?: string; body?: SpecV2Body }) {
  const body = resolveBody(input);
  const validation = validateSpecV2(body, {
    services: loadV2Services(),
    knownConnections: ["reddit:default"],
  });
  if (!validation.ok) {
    return {
      ok: false as const,
      status: 422,
      error: "Cannot freeze invalid Spec",
      validation,
    };
  }
  const draft = createDraftSpecV2({
    ...body,
    id: `specv2_desk_${Date.now().toString(36)}`,
  });
  const frozen = freezeSpecV2(draft, { frozenBy: "relay-desk" });
  return {
    ok: true as const,
    status: 200,
    spec: frozen,
    yaml: specBodyToYaml(body),
  };
}

export async function handleRun(input: {
  yaml?: string;
  body?: SpecV2Body;
  autoApprove?: boolean;
}) {
  const body = resolveBody(input);
  const services = loadV2Services();
  const validation = validateSpecV2(body, {
    services,
    knownConnections: ["reddit:default"],
  });
  if (!validation.ok) {
    return {
      ok: false as const,
      status: 422,
      error: "Cannot run invalid Spec",
      validation,
    };
  }

  const draft = createDraftSpecV2({ ...body });
  const frozen = freezeSpecV2(draft, { frozenBy: "relay-desk-run" });
  const lowered = lowerSpecV2(frozen, {
    name: "desk-run",
    specId: frozen.id,
    specRecord: {
      id: frozen.id,
      version: frozen.version,
      status: frozen.status,
      intentId: frozen.intentId,
    },
  });

  const evalReport = await runEvals({
    lowered,
    softFailClosed: false,
    fixtures: {
      cases: [
        {
          id: "gate_promo",
          rules: (body.rules ?? [])
            .filter((r) => r.id === "no_promo_links")
            .map((r) => r.id),
          scope: { draft: { text: "https://bad" } },
          expect: { rules: { no_promo_links: false } },
        },
      ].filter((c) => (c.rules?.length ?? 0) > 0),
    },
  });
  try {
    assertEvalsGate(evalReport);
  } catch (err) {
    return {
      ok: false as const,
      status: 422,
      error: err instanceof Error ? err.message : String(err),
      evalReport,
    };
  }

  const llm = createLlmEngine({ client: runtimeStubLlm() });
  const data = createDataEngine();
  const api = createApiEngine({
    services,
    dryRun: true,
    fixtures: [
      {
        service: "reddit-public",
        operation: "listNew",
        body: {
          posts: [
            {
              id: "t3_desk_1",
              subreddit: "malefashionadvice",
              threadTitle: "Capsule wardrobe basics?",
              opText: "Need a simple system.",
            },
            {
              id: "t3_desk_2",
              subreddit: "femalefashionadvice",
              threadTitle: "Work shoes that last?",
              opText: "Looking for durable options, not brands.",
            },
          ],
        },
      },
    ],
    resolveConnection: async () => ({ type: "bearer", token: "desk-dry-run" }),
    fetch: async () => {
      throw new Error("desk run: network disabled");
    },
  });

  const { runtime } = createWorkflowRuntime({
    lowered,
    engines: { api, llm, data },
    context: {
      agentId: "desk-1",
      userId: "operator",
      sessionId: `desk-${Date.now()}`,
    },
    assertRunnable: false,
    softFailClosed: true,
  });

  const autoApprove = input.autoApprove !== false;
  if (autoApprove) {
    runtime.on(AgentRuntimeEvent.FEEDBACK_REQUESTED, (req) => {
      void runtime.provideFeedback({
        requestId: req.id,
        agentId: req.agentId,
        action: "proceed",
        value: true,
      });
    });
  }

  await runtime.start();
  const ctx = runtime.getContext();
  return {
    ok: runtime.getState() === "COMPLETE",
    status: 200,
    state: runtime.getState(),
    specId: frozen.id,
    specHash: lowered.specHash,
    evidenceCount: getEvidence(ctx).length,
    stageResults: ctx.stageResults ?? {},
    note: autoApprove
      ? "Dry-run auto-approved HITL. For live HITL cards use Console + FEEDBACK_ADAPTER=desk."
      : "Waiting for HITL — wire Feedback Broker / Desk Console.",
  };
}
