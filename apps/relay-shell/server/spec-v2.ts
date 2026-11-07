/**
 * Spec v2 host API for Relay Desk — scaffold / validate / lower / evals / freeze / run.
 * No compiler inside Tauri; Desk calls these HTTP endpoints.
 */
import { join, resolve } from "node:path";
import { createLlmEngine } from "@relay/engines-llm";
import { createLlmClient, parseLlmProviderId, type LlmClient } from "@relay/llm";
import {
  buildRelayAppBundle,
  importRelayAppBundleJson,
  isRelayAppBundleError,
  type RelayAppBundle,
} from "@relay/app-bundle";
import {
  assertSchedulesValid,
  createDraftSpecV2,
  freezeSpecV2,
  listEnabledSchedules,
  type ServiceDescriptor,
  type SpecV2Body,
} from "@relay/protocol";
import {
  compileEvals,
  generateEvalFixtures,
  hasEvaluableFixtures,
  runEvals,
} from "@relay/spec-evals";
import {
  approveShadowEvidence,
  assertShadowGate,
  collectSimulatedWrites,
  createFileRunStateStore,
  createMemoryConnectionStore,
  isSpecHostError,
  listDueOutcomeFollowUps,
  listRunSummaries,
  processDueOutcomeFollowUps,
  replaySpecRun,
  resumeSpec,
  runSpec,
  type ListRunsQuery,
  type RunStateStore,
  type SpecHostMode,
  type SpecRunStatus,
} from "@relay/spec-host";
import {
  curatedKnownConnections,
  loadCuratedServices,
} from "@relay/services";
import { lowerSpecV2 } from "@relay/spec-lower";
import {
  errorsIncludeCapabilityGap,
  formatNeedsMessage,
  needsFromIntent,
  needsFromValidationIssues,
  scaffoldSpec,
  specBodyToYaml,
  withSlotsFromIntent,
} from "@relay/spec-scaffold";
import {
  normalizeSpecV2HardChecks,
  parseSpecV2Yaml,
  validateSpecV2,
} from "@relay/spec-validator";

/** Override for unit tests; production uses `.data/spec-runs`. */
let runStoreOverride: RunStateStore | undefined;

export function setDeskRunStateStoreForTests(
  store: RunStateStore | undefined
): void {
  runStoreOverride = store;
}

export function deskRunStateStore(): RunStateStore {
  if (runStoreOverride) return runStoreOverride;
  const root = resolve(
    process.cwd(),
    process.env.RELAY_DATA_DIR?.trim() || ".data"
  );
  return createFileRunStateStore(join(root, "spec-runs"));
}

/** Offline CE / triage-shaped fixtures for Desk fixture + app shadow runs. */
export function buildDeskApiFixtures(
  services: readonly { id: string; operations: readonly { id: string }[] }[]
) {
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
  const fixtureIssues = [
    {
      number: 1,
      title: "Desk shadow fixture issue",
      labels: [{ name: "bug" }],
      body: "Repro steps…",
    },
  ];
  return services.flatMap((s) =>
    s.operations.map((op) => {
      const id = s.id.toLowerCase();
      const opId = op.id.toLowerCase();
      let body: unknown;
      if (id.includes("reddit") && !opId.includes("comment")) {
        // CE Spec: forEach "${steps.scout.output.body.posts}"
        body = { posts: fixturePosts };
      } else if (
        id.includes("github") ||
        opId.includes("issues") ||
        opId.includes("list")
      ) {
        // Triage Spec: forEach "${steps.scout.output.body}" (array body)
        body = fixtureIssues;
      } else {
        body = { ok: true, deskFixture: true };
      }
      return { service: s.id, operation: op.id, body };
    })
  );
}

function deskFixtureApi() {
  const services = loadV2Services();
  // All curated refs get a Desk stub token so resume works for github ASAP path
  // (live secrets still win via deskAppConnectionStore on Apps Run once).
  const connectionStore = createMemoryConnectionStore(
    Object.fromEntries(
      deskKnownConnections().map((id) => [
        id,
        { type: "bearer" as const, token: "desk-dry-run" },
      ])
    )
  );
  return {
    services,
    connectionStore,
    apiFixtures: buildDeskApiFixtures(services),
  };
}

function mapHostError(err: unknown) {
  if (isSpecHostError(err)) {
    const status =
      err.code === "evals_gate" ||
      err.code === "invalid_spec" ||
      err.code === "shadow_gate_unapproved" ||
      err.code === "shadow_approval_requires_shadow" ||
      err.code === "shadow_approval_requires_complete" ||
      err.code === "no_spec_schedule"
        ? 422
        : err.code === "checkpoint_not_found" || err.code === "run_not_found"
          ? 404
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
  if (isRelayAppBundleError(err)) {
    return {
      ok: false as const,
      status: 422 as const,
      error: err.message,
      code: err.code,
      ...(typeof err.details === "object" && err.details
        ? (err.details as Record<string, unknown>)
        : {}),
    };
  }
  throw err;
}

let cachedServices: ReturnType<typeof loadCuratedServices> | null = null;

/** Curated catalog from `@relay/services` (reddit + github + slack + http-fetch + rss + notion). */
export function loadV2Services() {
  if (!cachedServices) {
    cachedServices = loadCuratedServices();
  }
  return cachedServices;
}

export function deskKnownConnections(): string[] {
  return curatedKnownConnections();
}

/** Which offline stub to emit when LLM scaffold is unavailable. */
export function stubKindFromIntent(
  intent: string
): "github" | "reddit" | "generic" {
  const t = intent.trim();
  if (/\bgithub\b/i.test(t) || /\bacme\/widgets\b/i.test(t)) return "github";
  if (/\breddit\b/i.test(t) || /\bsubreddit\b/i.test(t)) return "reddit";
  return "generic";
}

function goalFromIntent(intent: string, fallback: string): string {
  return (
    intent
      .split("\n")
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find((l) => l.length > 0) || fallback
  );
}

/** GitHub triage stub — ASAP closed-loop dogfood (matches triage-gen shape). */
function stubGithubTriage(intent: string): SpecV2Body {
  return {
    goal: goalFromIntent(
      intent,
      "Triage new bug issues in acme/widgets with a helpful first comment"
    ),
    connections: ["github:default"],
    services: ["github"],
    trigger: { schedule: { cron: "0 9 * * 1-5" } },
    budget: { maxJobs: 10, dryRun: true },
    rules: [
      {
        id: "no_promo_links",
        kind: "hard",
        check: { notMatches: "${draft.text}", pattern: "https?://" },
      },
      {
        id: "triage_quality",
        kind: "soft",
        judge: {
          rubric: ["acknowledgesBug", "asksForReproOrLogs", "suggestsNextStep"],
          minMean: 3.5,
        },
      },
    ],
    steps: [
      {
        id: "scout",
        use: "api.request",
        args: {
          service: "github",
          operation: "issuesListForRepo",
          connection: "github:default",
          params: {
            owner: "acme",
            repo: "widgets",
            labels: "bug",
            state: "open",
            per_page: 20,
          },
        },
        outputs: ["body"],
      },
      {
        id: "draft",
        use: "llm.generate",
        forEach: "${steps.scout.output.body}",
        args: {
          prompt:
            "Draft a short GitHub triage comment for this bug issue. Acknowledge the report, ask for repro or logs if missing, suggest one next step. No URLs. Return JSON with text and issue_number.",
          input: "${item}",
          schema: {
            type: "object",
            properties: {
              text: { type: "string" },
              issue_number: { type: "number" },
            },
            required: ["text", "issue_number"],
          },
        },
        enforce: ["no_promo_links", "triage_quality"],
      },
      {
        id: "approve",
        use: "human.approve",
        args: {
          show: "${steps.draft.output}",
          prompt: "Approve triage comments before post?",
        },
      },
      {
        id: "post",
        use: "api.request",
        forEach: "${steps.draft.output}",
        once: "${item.issue_number}",
        args: {
          service: "github",
          operation: "issuesCreateComment",
          connection: "github:default",
          method: "POST",
          params: {
            owner: "acme",
            repo: "widgets",
            issue_number: "${item.issue_number}",
            body: "${item.text}",
          },
        },
      },
    ],
  };
}

/** CE fashion stub — demo only, not ASAP success bar. */
function stubRedditFashion(intent: string): SpecV2Body {
  return {
    goal: goalFromIntent(
      intent,
      "Help people in allowlisted fashion subreddits with genuinely useful replies"
    ),
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
    ],
  };
}

/**
 * Catalog-only stub when intent does not match a known template.
 * No invented api.request — operator must name a curated service or import one.
 */
function stubGenericHitl(intent: string): SpecV2Body {
  return {
    goal: goalFromIntent(intent, "Draft a plan and ask before acting"),
    connections: [],
    services: [],
    trigger: { manual: true },
    budget: { dryRun: true, maxJobs: 1 },
    rules: [
      {
        id: "no_promo_links",
        kind: "hard",
        check: { notMatches: "${draft.text}", pattern: "https?://" },
      },
    ],
    steps: [
      {
        id: "draft",
        use: "llm.generate",
        args: {
          prompt:
            "Summarize the operator intent into a short action plan. No URLs. Return JSON with text.",
          input: intent.slice(0, 2000),
          schema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
        },
        enforce: ["no_promo_links"],
      },
      {
        id: "approve",
        use: "human.approve",
        args: {
          show: "${steps.draft.output}",
          prompt: "Approve this plan? (Add a curated service before API writes.)",
        },
      },
    ],
  };
}

/**
 * Offline / fallback Spec from intent — only curated catalog shapes.
 * ASAP default: GitHub triage when intent mentions GitHub.
 */
export function stubSpecFromIntent(
  intent: string,
  opts?: {
    services?: readonly ServiceDescriptor[];
    knownConnections?: readonly string[];
  }
): SpecV2Body {
  const kind = stubKindFromIntent(intent);
  const raw =
    kind === "github"
      ? stubGithubTriage(intent)
      : kind === "reddit"
        ? stubRedditFashion(intent)
        : stubGenericHitl(intent);
  return withSlotsFromIntent(raw, {
    intent,
    catalog: opts?.services ?? loadV2Services(),
    knownConnections: opts?.knownConnections ?? deskKnownConnections(),
  });
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

export function runtimeStubLlm(): LlmClient {
  return {
    provider: "gemini",
    async completeJson(req) {
      const props =
        req.schema &&
        typeof req.schema === "object" &&
        (req.schema as { properties?: Record<string, unknown> }).properties
          ? ((req.schema as { properties: Record<string, unknown> }).properties)
          : {};
      // Soft-rule judges always ask for rationale + rubric dims (see llm-engine judgeSchema).
      if ("rationale" in props) {
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
      // Match schema shape: GitHub triage wants issue_number; CE reddit wants thing_id.
      if ("issue_number" in props) {
        const n = Number(item.number ?? item.issue_number ?? 1);
        return {
          text: JSON.stringify({
            text: `Thanks for the report on "${String(item.title ?? "this issue")}". Can you share repro steps or logs? Next: I'll reproduce locally.`,
            issue_number: Number.isFinite(n) ? n : 1,
          }),
          provider: "gemini",
          model: "desk-stub",
        };
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
  const known = deskKnownConnections();
  const preflight = needsFromIntent(intent, services, known);
  if (preflight.length) {
    return {
      ok: false as const,
      status: 422,
      mode: "needs" as const,
      error: formatNeedsMessage(preflight),
      needs: preflight,
      attempts: 0,
      note:
        "This Desk only scaffolds against the curated catalog (github, reddit, slack, …). Import a descriptor or pick a catalog preset, then retry.",
    };
  }

  const live = input.stub === true ? null : tryLiveLlmClient();

  if (!live) {
    const body = stubSpecFromIntent(intent, {
      services,
      knownConnections: known,
    });
    const validation = validateSpecV2(body, {
      services,
      knownConnections: known,
    });
    if (!validation.ok && errorsIncludeCapabilityGap(validation.errors)) {
      const needs = needsFromValidationIssues(validation.errors);
      return {
        ok: false as const,
        status: 422,
        mode: "needs" as const,
        error: formatNeedsMessage(needs),
        needs,
        yaml: specBodyToYaml(body),
        body,
        validation,
        attempts: 1,
        note:
          "Stub Spec hit a catalog gap — use GitHub triage / CE fashion presets, or import a descriptor.",
      };
    }
    const evals = generateEvalFixtures(body);
    return {
      ok: true as const,
      status: 200,
      mode: "stub" as const,
      body,
      yaml: specBodyToYaml(body),
      validation,
      attempts: 1,
      evals,
      note:
        stubKindFromIntent(intent) === "github"
          ? "Offline stub: GitHub triage (ASAP dogfood). Connect github:default before live Run once."
          : stubKindFromIntent(intent) === "reddit"
            ? "Offline stub: CE fashion (demo). ASAP success bar is GitHub triage."
            : "Offline stub: HITL-only plan (no API). Name a curated service in the intent for api.request.",
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
    knownConnections: deskKnownConnections(),
    maxRepairs: 3,
  });
  console.log(
    `[scaffold] llm done ok=${result.ok} attempts=${result.attempts} needs=${
      !result.ok && result.needs?.length ? result.needs.length : 0
    } ms=${Date.now() - t0}`
  );
  if (!result.ok && result.needs?.length) {
    return {
      ok: false as const,
      status: 422,
      mode: "needs" as const,
      error: result.message,
      errors: result.errors,
      needs: result.needs,
      yaml: result.yaml,
      body: result.lastBody,
      attempts: result.attempts,
      note:
        "Add the missing service descriptor or connection, then retry Scaffold. See packages/openapi-import and @relay/services.",
    };
  }
  if (!result.ok) {
    // Keep Desk usable: prefer last LLM draft, else deterministic stub for this Intent.
    const fallbackRaw = result.lastBody ?? stubSpecFromIntent(intent, { services, knownConnections: known });
    const fallbackBody = withSlotsFromIntent(fallbackRaw, {
      intent,
      catalog: services,
      knownConnections: known,
    });
    const fallbackYaml = result.yaml ?? specBodyToYaml(fallbackBody);
    const fallbackValidation = validateSpecV2(fallbackBody, {
      services,
      knownConnections: deskKnownConnections(),
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
    evals: result.evals,
  };
}

export function handleValidate(input: { yaml?: string; body?: SpecV2Body }) {
  const body = resolveBody(input);
  const validation = validateSpecV2(body, {
    services: loadV2Services(),
    knownConnections: deskKnownConnections(),
  });
  return {
    ok: validation.ok,
    status: 200,
    body,
    yaml: specBodyToYaml(body),
    validation,
  };
}

/**
 * Ship (cs3): operator picks a binding candidate for a capability slot.
 * Never auto-selects degraded — caller must pass candidateIndex explicitly.
 */
export function handleResolveSlot(input: {
  yaml?: string;
  body?: SpecV2Body;
  slotId?: string;
  candidateIndex?: number;
}) {
  const slotId = String(input.slotId ?? "").trim();
  if (!slotId) {
    return { ok: false as const, status: 400, error: "slotId required" };
  }
  if (
    typeof input.candidateIndex !== "number" ||
    !Number.isInteger(input.candidateIndex) ||
    input.candidateIndex < 0
  ) {
    return {
      ok: false as const,
      status: 400,
      error: "candidateIndex must be a non-negative integer",
    };
  }
  let body: SpecV2Body;
  try {
    body = resolveBody(input);
  } catch (err) {
    return {
      ok: false as const,
      status: 400,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const slots = body.slots ?? [];
  const slotIdx = slots.findIndex((s) => s.id === slotId);
  if (slotIdx < 0) {
    return {
      ok: false as const,
      status: 404,
      error: `Unknown slot ${JSON.stringify(slotId)}`,
    };
  }
  const slot = slots[slotIdx]!;
  const candidate = slot.candidates[input.candidateIndex];
  if (!candidate) {
    return {
      ok: false as const,
      status: 400,
      error: `candidateIndex ${input.candidateIndex} out of range for ${slotId}`,
    };
  }
  if (candidate.status === "blocked") {
    return {
      ok: false as const,
      status: 422,
      error: `Candidate is blocked${candidate.reason ? ` — ${candidate.reason}` : ""}`,
    };
  }

  const resolved =
    candidate.connection?.trim() ||
    (candidate.service
      ? `${candidate.service}:slot`
      : `binding:${candidate.binding}`);
  const degraded = candidate.status === "degraded";
  const nextSlot = {
    ...slot,
    preferredCandidateIndex: input.candidateIndex,
    resolved,
  };
  const nextSlots = slots.map((s, i) => (i === slotIdx ? nextSlot : s));
  const connections = [...(body.connections ?? [])];
  if (
    candidate.connection &&
    !connections.includes(candidate.connection)
  ) {
    connections.push(candidate.connection);
  }
  const nextBody: SpecV2Body = {
    ...body,
    slots: nextSlots,
    connections: connections.length ? connections : body.connections,
  };

  return {
    ok: true as const,
    status: 200,
    body: nextBody,
    yaml: specBodyToYaml(nextBody),
    slot: nextSlot,
    candidate,
    degraded,
    note: degraded
      ? `Resolved ${slotId} → ${candidate.binding}${candidate.service ? ` / ${candidate.service}` : ""} (degraded — ${candidate.reason ?? "limited path"}). Mark ready + shadow before live writes.`
      : `Resolved ${slotId} → ${candidate.binding}${candidate.service ? ` / ${candidate.service}` : ""}${candidate.connection ? ` · ${candidate.connection}` : ""}. Mark ready if needed, then shadow before live writes.`,
  };
}

export function handleLower(input: { yaml?: string; body?: SpecV2Body }) {
  const body = resolveBody(input);
  const validation = validateSpecV2(body, {
    services: loadV2Services(),
    knownConnections: deskKnownConnections(),
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
  const pack = generateEvalFixtures(body);
  const cases = pack.cases;
  if (!hasEvaluableFixtures(pack)) {
    return {
      ok: false as const,
      status: 422,
      compiled,
      report: {
        compiled,
        cases: [],
        passed: false,
        errors: [
          "No hard rules with in/list, notMatches/pattern, or eq/neq — add them before evals",
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

export async function handleFreeze(input: {
  yaml?: string;
  body?: SpecV2Body;
  /** Skip generated-eval gate (default false — fail closed). */
  skipEvalsGate?: boolean;
}) {
  const body = resolveBody(input);
  const validation = validateSpecV2(body, {
    services: loadV2Services(),
    knownConnections: deskKnownConnections(),
  });
  if (!validation.ok) {
    return {
      ok: false as const,
      status: 422,
      error: "Cannot freeze invalid Spec",
      validation,
    };
  }

  const evals = generateEvalFixtures(body);
  let evalReport: Awaited<ReturnType<typeof runEvals>> | undefined;
  if (!input.skipEvalsGate) {
    if (!hasEvaluableFixtures(evals)) {
      return {
        ok: false as const,
        status: 422,
        error:
          "Cannot freeze without evaluable hard-rule fixtures (add in/list, notMatches, or eq/neq)",
        validation,
        evals,
      };
    }
    evalReport = await runEvals({
      spec: body,
      softFailClosed: false,
      llmEngine: createLlmEngine({ client: runtimeStubLlm() }),
      fixtures: evals,
    });
    if (!evalReport.passed) {
      return {
        ok: false as const,
        status: 422,
        error: "Evals gate failed — fix Spec or fixtures before freeze",
        validation,
        evals,
        evalReport,
      };
    }
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
    evals,
    evalReport,
  };
}

function runResultPayload(
  result: Awaited<ReturnType<typeof runSpec>>,
  note: string
) {
  const simulatedWrites = collectSimulatedWrites(
    result.stepOutputs ?? {},
    result.evidence ?? []
  );
  return {
    ok: result.ok,
    status: 200 as const,
    state: result.state,
    runId: result.runId,
    specId: result.specId,
    specHash: result.specHash,
    mode: result.mode,
    dryRun: result.dryRun,
    blockNetwork: result.blockNetwork,
    simulatedWriteCount: result.simulatedWriteCount,
    simulatedWrites,
    evidenceCount: result.evidenceCount,
    evidence: result.evidence,
    evidenceApproval: result.checkpoint?.evidenceApproval,
    outcomeFollowUps: result.checkpoint?.outcomeFollowUps,
    stageResults: result.stageResults,
    stepOutputs: result.stepOutputs,
    checkpoint: result.checkpoint
      ? {
          status: result.checkpoint.status,
          stageName: result.checkpoint.stageName,
          createdAt: result.checkpoint.createdAt,
          updatedAt: result.checkpoint.updatedAt,
          hitlDecisionCount: result.checkpoint.hitlDecisions?.length ?? 0,
          evidenceApproved: Boolean(
            result.checkpoint.evidenceApproval?.approvedAt
          ),
          outcomeFollowUpCount:
            result.checkpoint.outcomeFollowUps?.length ?? 0,
        }
      : undefined,
    pendingFeedback: result.pendingFeedback,
    note,
  };
}

export async function handleRun(input: {
  yaml?: string;
  body?: SpecV2Body;
  autoApprove?: boolean;
  /** Desk default fixture; shadow for evidence-gate rehearsal (still fixture APIs). */
  mode?: SpecHostMode;
}) {
  const body = resolveBody(input);
  const autoApprove = input.autoApprove !== false;
  const mode: SpecHostMode =
    input.mode === "shadow" || input.mode === "live" ? input.mode : "fixture";
  if (mode === "live") {
    return {
      ok: false as const,
      status: 422,
      error:
        "Desk /api/v2/run does not enable live writes — use shadow (simulated writes) or fixture",
      code: "desk_live_forbidden",
    };
  }
  const { services, connectionStore, apiFixtures } = deskFixtureApi();
  const evals = generateEvalFixtures(body);
  const runStateStore = deskRunStateStore();

  try {
    const result = await runSpec({
      body,
      services,
      connectionStore,
      llmClient: runtimeStubLlm(),
      mode,
      dryRun: true,
      // Desk stays offline; shadow still records shadowWrite evidence for the gate.
      blockNetwork: true,
      apiFixtures,
      hitl: {
        autoApprove,
        pauseAndReturn: !autoApprove,
        runStateStore,
      },
      evals: hasEvaluableFixtures(evals)
        ? { cases: evals.cases, softFailClosed: false }
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

    const modeNote =
      mode === "shadow"
        ? "shadow mode (writes simulated; network blocked in Desk). Approve evidence before enabling schedule."
        : "fixture mode via @relay/spec-host (network blocked, stub LLM). Run persisted — GET /api/v2/runs.";

    return runResultPayload(
      result,
      autoApprove
        ? modeNote
        : "Paused for HITL — POST /api/v2/runs/:runId/resume with { action, value }."
    );
  } catch (err) {
    return mapHostError(err);
  }
}

export async function handleListRuns(query: {
  specId?: string;
  specHash?: string;
  status?: string;
  limit?: string | number;
}) {
  const store = deskRunStateStore();
  const limitRaw =
    typeof query.limit === "string" ? Number(query.limit) : query.limit;
  const q: ListRunsQuery = {
    specId: query.specId || undefined,
    specHash: query.specHash || undefined,
    status: (query.status || undefined) as SpecRunStatus | undefined,
    limit:
      limitRaw != null && Number.isFinite(limitRaw) && limitRaw >= 0
        ? limitRaw
        : 50,
  };
  const runs = await listRunSummaries(store, q);
  return { ok: true as const, status: 200, runs };
}

export async function handleGetRun(runId: string) {
  const run = await deskRunStateStore().get(runId);
  if (!run) {
    return {
      ok: false as const,
      status: 404,
      error: `Run not found: ${runId}`,
    };
  }
  const simulatedWrites = collectSimulatedWrites(
    run.stepOutputs ?? {},
    run.evidence ?? []
  );
  return {
    ok: true as const,
    status: 200,
    run,
    simulatedWrites,
    evidenceApproval: run.evidenceApproval,
    outcomeFollowUps: run.outcomeFollowUps,
  };
}

/**
 * Process due outcome follow-ups (Desk sweep / force measure).
 * Default measure returns metric.min when set, else 1 — for offline demo only.
 */
export async function handleProcessOutcomes(input: {
  ruleId?: string;
  specHash?: string;
  /** ISO; default now. Pass a future/past stamp in tests. */
  now?: string;
  /** Demo numeric value when no live measure is wired. */
  value?: number;
}) {
  try {
    const store = deskRunStateStore();
    if (input.ruleId) {
      const out = await processDueOutcomeFollowUps(store, {
        entrypointOrRuleId: input.ruleId.startsWith("outcome_")
          ? input.ruleId
          : `outcome_${input.ruleId}`,
        specHash: input.specHash,
        now: input.now,
        measure: async (followUp) => ({
          value:
            input.value ??
            followUp.min ??
            1,
          detail: { source: "desk-process" },
        }),
      });
      return {
        ok: true as const,
        status: 200,
        processed: out.processed,
        runIds: out.runIds,
        note:
          out.processed > 0
            ? `Recorded ${out.processed} outcome follow-up(s).`
            : "No due outcome follow-ups for that rule.",
      };
    }
    const due = await listDueOutcomeFollowUps(store, {
      specHash: input.specHash,
      now: input.now,
      limit: 50,
    });
    const runIds: string[] = [];
    for (const { followUp } of due) {
      await processDueOutcomeFollowUps(store, {
        entrypointOrRuleId: followUp.ruleId,
        specHash: input.specHash,
        now: input.now,
        measure: async (fu) => ({
          value: input.value ?? fu.min ?? 1,
          detail: { source: "desk-process" },
        }),
      });
      runIds.push(followUp.parentRunId);
    }
    return {
      ok: true as const,
      status: 200,
      processed: runIds.length,
      runIds,
      note:
        runIds.length > 0
          ? `Recorded ${runIds.length} outcome follow-up(s).`
          : "No due outcome follow-ups.",
    };
  } catch (err) {
    return mapHostError(err);
  }
}

export async function handleApproveEvidence(
  runId: string,
  input: { approvedBy?: string; note?: string } = {}
) {
  try {
    const run = await approveShadowEvidence(deskRunStateStore(), runId, {
      approvedBy: input.approvedBy ?? "desk-operator",
      note: input.note,
    });
    return {
      ok: true as const,
      status: 200,
      runId: run.runId,
      specHash: run.specHash,
      evidenceApproval: run.evidenceApproval,
      note: "Shadow evidence approved — schedule enable is unlocked for this Spec hash.",
    };
  } catch (err) {
    return mapHostError(err);
  }
}

/**
 * Fail-closed schedule enable check: requires approved shadow evidence for Spec hash.
 * Does not start a long-lived SchedulerHost in Desk — returns gate result only.
 */
export async function handleEnableSchedule(input: {
  yaml?: string;
  body?: SpecV2Body;
  runId?: string;
}) {
  try {
    const body = resolveBody(input);
    const lowered = lowerSpecV2(body, { name: "desk-schedule" });
    assertSchedulesValid(lowered.manifest);
    const schedules = listEnabledSchedules(lowered.manifest);
    if (!schedules.length) {
      return {
        ok: false as const,
        status: 422,
        error:
          "Spec has no schedule/poll trigger to enable (use trigger.schedule or trigger.poll)",
        code: "no_spec_schedule",
      };
    }
    const approved = await assertShadowGate({
      store: deskRunStateStore(),
      specHash: lowered.specHash,
      runId: input.runId,
    });
    return {
      ok: true as const,
      status: 200,
      enabled: true,
      specHash: lowered.specHash,
      approvedRunId: approved.runId,
      evidenceApproval: approved.evidenceApproval,
      schedules: schedules.map((s) => ({
        id: s.id,
        entrypoint: s.entrypoint,
        cron: s.cron,
        every_ms: s.every_ms,
        enabled: s.enabled !== false,
      })),
      note: "Shadow gate passed — schedule may be armed (Desk check only; host not started).",
    };
  } catch (err) {
    return mapHostError(err);
  }
}

/** Export a content-addressed Relay App bundle from Spec YAML/body. */
export async function handleExportBundle(input: {
  yaml?: string;
  body?: SpecV2Body;
}) {
  try {
    const body = resolveBody(input);
    const validation = validateSpecV2(body, {
      services: loadV2Services(),
      knownConnections: deskKnownConnections(),
    });
    if (!validation.ok) {
      return {
        ok: false as const,
        status: 422,
        error: "Spec validation failed — fix before export",
        validation,
      };
    }
    const bundle = buildRelayAppBundle({
      body,
      services: loadV2Services(),
      frozenBy: "relay-desk-export",
      name: "desk-export",
    });
    return {
      ok: true as const,
      status: 200,
      bundle,
      note: `Exported Relay App ${bundle.id.slice(0, 20)}… (specHash ${bundle.specHash.slice(0, 12)}…)`,
    };
  } catch (err) {
    return mapHostError(err);
  }
}

/** Import + verify a Relay App bundle JSON. */
export async function handleImportBundle(input: {
  bundle?: unknown;
  json?: string;
}) {
  try {
    let bundle: RelayAppBundle;
    if (typeof input.json === "string" && input.json.trim()) {
      bundle = importRelayAppBundleJson(input.json);
    } else if (input.bundle != null) {
      bundle = importRelayAppBundleJson(JSON.stringify(input.bundle));
    } else {
      return {
        ok: false as const,
        status: 400,
        error: "Provide bundle object or json string",
      };
    }
    return {
      ok: true as const,
      status: 200,
      bundle,
      yaml: specBodyToYaml(bundle.body),
      note: `Imported ${bundle.id.slice(0, 20)}… — connect ${bundle.requiredConnections.join(", ") || "(none)"} then shadow-run before enable.`,
    };
  } catch (err) {
    return mapHostError(err);
  }
}

export async function handleReplayRun(runId: string) {
  const { services, connectionStore, apiFixtures } = deskFixtureApi();
  const runStateStore = deskRunStateStore();
  try {
    const result = await replaySpecRun({
      runId,
      runStateStore,
      services,
      connectionStore,
      llmClient: runtimeStubLlm(),
      mode: "fixture",
      dryRun: true,
      blockNetwork: true,
      apiFixtures,
      hitl: { autoApprove: true, runStateStore },
      name: "desk-replay",
      frozenBy: "relay-desk-replay",
      context: {
        agentId: "desk-1",
        userId: "operator",
        sessionId: `desk-replay-${Date.now()}`,
      },
      assertRunnable: false,
      softFailClosed: true,
    });
    return runResultPayload(
      result,
      `Replayed frozen Spec from ${runId} (new runId=${result.runId ?? "?"}).`
    );
  } catch (err) {
    return mapHostError(err);
  }
}

export async function handleResumeRun(
  runId: string,
  input: {
    action?: "proceed" | "abort" | "retry";
    value?: unknown;
    agentId?: string;
  }
) {
  const { services, connectionStore, apiFixtures } = deskFixtureApi();
  const runStateStore = deskRunStateStore();
  try {
    const result = await resumeSpec({
      runId,
      runStateStore,
      feedback: {
        action: input.action ?? "proceed",
        value: input.value,
        agentId: input.agentId,
      },
      services,
      connectionStore,
      llmClient: runtimeStubLlm(),
      apiFixtures,
      // Honor checkpoint mode/dryRun (Apps Run once is live + dryRun false).
      blockNetwork: true,
      hitl: {
        autoApprove: false,
        pauseAndReturn: true,
        runStateStore,
      },
      assertRunnable: false,
      softFailClosed: true,
    });
    return runResultPayload(
      result,
      result.state === "WAITING_USER"
        ? "Still waiting on HITL — resume again when ready."
        : `Resumed ${runId} → ${result.state}.`
    );
  } catch (err) {
    return mapHostError(err);
  }
}
