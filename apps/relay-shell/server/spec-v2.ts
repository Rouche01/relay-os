/**
 * Spec v2 host API for Relay Desk — scaffold / validate / lower / evals / freeze / run.
 * No compiler inside Tauri; Desk calls these HTTP endpoints.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLlmEngine } from "@relay/engines-llm";
import { createLlmClient, parseLlmProviderId, type LlmClient } from "@relay/llm";
import {
  createDraftSpecV2,
  freezeSpecV2,
  parseServiceDescriptorYaml,
  parseSpecV2Ref,
  type SpecV2Body,
  type SpecV2HardRule,
} from "@relay/protocol";
import { compileEvals, runEvals } from "@relay/spec-evals";
import {
  createMemoryConnectionStore,
  isSpecHostError,
  runSpec,
} from "@relay/spec-host";
import { lowerSpecV2 } from "@relay/spec-lower";
import { scaffoldSpec, specBodyToYaml } from "@relay/spec-scaffold";
import {
  normalizeSpecV2HardChecks,
  parseSpecV2Yaml,
  validateSpecV2,
} from "@relay/spec-validator";

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
  // parseSpecV2Yaml already normalizes; body path needs an explicit pass
  // so LLM-collapsed notMatches/pattern still repair on Validate/Evals.
  if (input.body) return normalizeSpecV2HardChecks(input.body);
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

  const t0 = Date.now();
  console.log(
    `[scaffold] llm start intentChars=${intent.length} (expect 30–90s)`
  );
  const result = await scaffoldSpec({
    intent,
    client: live,
    services,
    knownConnections: ["reddit:default"],
    maxRepairs: 3,
  });
  console.log(
    `[scaffold] llm done ok=${result.ok} attempts=${result.attempts} ms=${
      Date.now() - t0
    }`
  );
  if (!result.ok) {
    // Keep Desk usable: prefer last LLM draft, else deterministic stub for this Intent.
    const fallbackBody = result.lastBody ?? stubSpecFromIntent(intent);
    const fallbackYaml = result.yaml ?? specBodyToYaml(fallbackBody);
    const fallbackValidation = validateSpecV2(fallbackBody, {
      services,
      knownConnections: ["reddit:default"],
    });
    return {
      ok: false as const,
      status: 422,
      mode: result.lastBody ? ("llm" as const) : ("stub" as const),
      error: result.message,
      errors: result.errors,
      yaml: fallbackYaml,
      body: fallbackBody,
      attempts: result.attempts,
      validation: fallbackValidation.ok
        ? {
            ok: false as const,
            errors: result.errors,
            warnings: fallbackValidation.warnings,
          }
        : fallbackValidation,
      note: result.lastBody
        ? "Partial LLM draft loaded — fix validation errors or retry Scaffold"
        : "LLM scaffold failed; loaded deterministic stub — edit or retry",
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

/** Assign `value` at a dotted path, creating intermediate objects. */
function assignPath(
  root: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) return;
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = cur[key];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/**
 * Seed fixture scope so hard-rule `${…}` refs resolve — mirrors common
 * draft/output/steps.<id>.output aliases plus the exact paths from the Spec.
 */
function deskEvalFixtures(body: SpecV2Body) {
  const rules = body.rules ?? [];
  const hard = rules.filter((r): r is SpecV2HardRule => r.kind === "hard");
  const promo =
    hard.find((r) => "notMatches" in r.check && "pattern" in r.check) ??
    hard.find((r) => /promo|link|url|http/i.test(r.id));
  const allow =
    hard.find((r) => "in" in r.check && "list" in r.check) ??
    hard.find((r) => /allow|subreddit|allowlist/i.test(r.id));
  const draftStep =
    body.steps.find((s) => s.use === "llm.generate")?.id ??
    body.steps.find((s) => /draft|reply|generate|compose/i.test(s.id))?.id ??
    "draft";

  const goodText = "Pick one versatile base layer.";
  const badText = "see https://spam.example/fit";
  const goodSub = "malefashionadvice";
  const badSub = "OUTFITS";

  function scopeFor(opts: { text: string; subreddit: string }) {
    const draft = { text: opts.text };
    const scope: Record<string, unknown> = {
      draft,
      output: draft,
      item: { subreddit: opts.subreddit },
      steps: { [draftStep]: { output: draft } },
      [draftStep]: draft,
    };

    // Exact paths from this Spec's hard checks (LLM often invents new refs).
    for (const rule of hard) {
      const check = rule.check;
      if ("notMatches" in check) {
        const path = parseSpecV2Ref(String(check.notMatches ?? ""));
        if (path) {
          if (path.endsWith(".text") || path === "text") {
            assignPath(scope, path, opts.text);
          } else {
            assignPath(scope, path, draft);
          }
        }
      }
      if ("matches" in check) {
        const path = parseSpecV2Ref(String(check.matches ?? ""));
        if (path) {
          if (path.endsWith(".text") || path === "text") {
            assignPath(scope, path, opts.text);
          } else {
            assignPath(scope, path, draft);
          }
        }
      }
      if ("in" in check) {
        const path = parseSpecV2Ref(String(check.in ?? ""));
        if (path) assignPath(scope, path, opts.subreddit);
      }
    }
    return scope;
  }

  const cases = [];
  const goodRules = [promo?.id, allow?.id].filter(
    (id): id is string => typeof id === "string"
  );
  if (goodRules.length) {
    cases.push({
      id: "good_draft",
      rules: goodRules,
      output: { text: goodText },
      scope: scopeFor({ text: goodText, subreddit: goodSub }),
    });
  }
  if (promo && "notMatches" in promo.check) {
    cases.push({
      id: "bad_promo",
      description: "Promo link must fail the notMatches hard rule",
      rules: [promo.id],
      output: { text: badText },
      scope: scopeFor({ text: badText, subreddit: goodSub }),
      expect: { rules: { [promo.id]: false } },
    });
  }
  if (allow && "in" in allow.check) {
    cases.push({
      id: "bad_subreddit",
      description: "Off-allowlist subreddit must fail the in/list hard rule",
      rules: [allow.id],
      output: { text: goodText },
      scope: scopeFor({ text: goodText, subreddit: badSub }),
      expect: { rules: { [allow.id]: false } },
    });
  }
  return cases;
}

export async function handleEvals(input: { yaml?: string; body?: SpecV2Body }) {
  const body = resolveBody(input);
  const compiled = compileEvals(body);
  const cases = deskEvalFixtures(body);
  if (!cases.length) {
    return {
      ok: false as const,
      status: 422,
      compiled,
      report: {
        compiled,
        cases: [],
        passed: false,
        errors: [
          "No hard rules with in/list or notMatches/pattern — add them before evals",
        ],
      },
      error: "No evaluable hard-rule fixtures for this Spec",
    };
  }
  const report = await runEvals({
    spec: body,
    softFailClosed: false,
    llmEngine: createLlmEngine({ client: runtimeStubLlm() }),
    fixtures: { cases },
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
  const autoApprove = input.autoApprove !== false;

  // Desk still supplies fixture posts + stub LLM for offline demo (h3 moves
  // shadow/live into the host). Engines/run path is generic via @relay/spec-host.
  const fixturePosts = [
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
  ];
  const publicOps = services
    .find((s) => s.id === "reddit-public")
    ?.operations.map((o) => o.id) ?? ["listNew"];
  const apiFixtures = publicOps.map((operation) => ({
    service: "reddit-public",
    operation,
    body: { posts: fixturePosts },
  }));

  const gateCases = deskEvalFixtures(body);

  try {
    const result = await runSpec({
      body,
      services,
      connectionStore: createMemoryConnectionStore({
        "reddit:default": { type: "bearer", token: "desk-dry-run" },
      }),
      llmClient: runtimeStubLlm(),
      mode: "fixture",
      dryRun: true,
      blockNetwork: true,
      apiFixtures,
      hitl: { autoApprove },
      evals: gateCases.length
        ? { cases: gateCases, softFailClosed: false }
        : undefined,
      name: "desk-run",
      frozenBy: "relay-desk-run",
      context: {
        agentId: "desk-1",
        userId: "operator",
        sessionId: `desk-${Date.now()}`,
      },
      assertRunnable: false,
      softFailClosed: true,
    });

    return {
      ok: result.ok,
      status: 200,
      state: result.state,
      specId: result.specId,
      specHash: result.specHash,
      mode: result.mode,
      dryRun: result.dryRun,
      blockNetwork: result.blockNetwork,
      simulatedWriteCount: result.simulatedWriteCount,
      evidenceCount: result.evidenceCount,
      evidence: result.evidence,
      stageResults: result.stageResults,
      stepOutputs: result.stepOutputs,
      note: autoApprove
        ? "fixture mode via @relay/spec-host (network blocked, stub LLM). Pass mode=shadow|live on a future Desk control for live reads / gated writes — see packages/spec-host/MODES.md."
        : "Waiting for HITL — wire Feedback Broker / Desk Console.",
    };
  } catch (err) {
    if (isSpecHostError(err)) {
      const status = err.code === "evals_gate" || err.code === "invalid_spec"
        ? 422
        : 400;
      return {
        ok: false as const,
        status,
        error: err.message,
        code: err.code,
        ...(typeof err.details === "object" && err.details
          ? (err.details as Record<string, unknown>)
          : {}),
      };
    }
    throw err;
  }
}
