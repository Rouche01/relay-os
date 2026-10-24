import type { FeedbackAdapter } from "@relay/feedback-broker";
import {
  freezeSpec,
  isAbortResponse,
  isEditResponse,
  type FeedbackRequest,
  type Spec,
} from "@relay/protocol";
import {
  compileEngageFromSlots,
  resolveFeedbackAdapterFromSpec,
  type FeedbackAdapterKind,
} from "./engage-compiler.js";
import { bindingsFromSpec } from "./runtime-bind.js";

export type SpecHitlResult =
  | { aborted: false; spec: Spec }
  | { aborted: true; spec: Spec; reason: string };

function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `spec-hitl_${crypto.randomUUID()}`;
  }
  return `spec-hitl_${Date.now().toString(36)}`;
}

/** Render Spec fields for CLI / Telegram cards. */
export function formatSpecForHitl(spec: Spec): {
  title: string;
  body: string;
  details: Array<{ label: string; value: string }>;
} {
  const details = [
    { label: "status", value: spec.status },
    { label: "procedure", value: `${spec.procedure.appId}/${spec.procedure.entrypoint}` },
    {
      label: "budget",
      value: `maxJobs=${spec.budget.maxJobs ?? "—"} dryRun=${spec.budget.dryRun ?? "—"}`,
    },
    {
      label: "binding",
      value: spec.actionBinding,
    },
    {
      label: "constraints",
      value: spec.constraints.map((c) => c.id).join(", ") || "(none)",
    },
    {
      label: "acceptance",
      value: spec.acceptance.map((a) => a.id).join(", ") || "(none)",
    },
  ];
  const body = [
    spec.goal,
    "",
    "Approve to run under this Spec.",
    "Abort to cancel the run.",
    "Edit: change the goal text, or use lines like maxJobs=2 / dryRun=true / allowPromo=false / adapter=cli|telegram",
  ].join("\n");
  return {
    title: `Spec ${spec.id.slice(0, 18)}… v${spec.version}`,
    body,
    details,
  };
}

export function buildSpecHitlRequest(
  spec: Spec,
  agentId: string
): FeedbackRequest {
  const formatted = formatSpecForHitl(spec);
  return {
    id: newRequestId(),
    agentId,
    type: "approval",
    prompt: "Approve this Spec to start the run? (approve | abort | edit: …)",
    required: true,
    context: {
      subjectId: spec.id,
      title: formatted.title,
      body: formatted.body,
      details: formatted.details,
      meta: { kind: "spec_freeze", specId: spec.id, version: spec.version },
    },
  };
}

/**
 * Parse Spec edit text into slot overrides + optional new goal.
 * Supports:
 * - freeform → new goal
 * - `maxJobs=2`, `dryRun=true`, `allowPromo=false`, `forceDiscover=true`
 * - `adapter=cli|telegram`
 * - `goal: …` or `goal=…` for an explicit goal line
 */
export function parseSpecEdit(text: string): {
  goal?: string;
  maxJobs?: number;
  dryRun?: boolean;
  allowPromo?: boolean;
  forceDiscover?: boolean;
  adapter?: FeedbackAdapterKind;
} {
  const trimmed = text.trim();
  if (!trimmed) return {};

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const kv: Record<string, string> = {};
  const goalLines: string[] = [];

  for (const line of lines) {
    const goalM = /^(goal)\s*[:=]\s*(.+)$/i.exec(line);
    if (goalM?.[2]) {
      goalLines.push(goalM[2].trim());
      continue;
    }
    const m =
      /^(maxJobs|dryRun|allowPromo|forceDiscover|adapter)\s*[:=]\s*(.+)$/i.exec(
        line
      );
    if (m?.[1] && m[2] !== undefined) {
      kv[m[1].toLowerCase()] = m[2].trim();
      continue;
    }
    goalLines.push(line);
  }

  const out: {
    goal?: string;
    maxJobs?: number;
    dryRun?: boolean;
    allowPromo?: boolean;
    forceDiscover?: boolean;
    adapter?: FeedbackAdapterKind;
  } = {};

  if (goalLines.length) out.goal = goalLines.join(" ").trim();

  if (kv.maxjobs != null) {
    const n = Number(kv.maxjobs);
    if (Number.isFinite(n) && n >= 0) out.maxJobs = Math.floor(n);
  }
  const parseBool = (v: string | undefined): boolean | undefined => {
    if (v == null) return undefined;
    const s = v.toLowerCase();
    if (["1", "true", "yes", "on"].includes(s)) return true;
    if (["0", "false", "no", "off"].includes(s)) return false;
    return undefined;
  };
  const dry = parseBool(kv.dryrun);
  if (dry !== undefined) out.dryRun = dry;
  const promo = parseBool(kv.allowpromo);
  if (promo !== undefined) out.allowPromo = promo;
  const disc = parseBool(kv.forcediscover);
  if (disc !== undefined) out.forceDiscover = disc;
  if (kv.adapter != null) {
    const a = kv.adapter.toLowerCase();
    if (a === "telegram" || a === "tg") out.adapter = "telegram";
    else if (a === "cli" || a === "terminal" || a === "stdin") out.adapter = "cli";
  }

  return out;
}

/** Rebuild a frozen Spec from an approved edit against the previous Spec. */
export function applySpecEdit(spec: Spec, editText: string, frozenBy: string): Spec {
  const parsed = parseSpecEdit(editText);
  const prior = bindingsFromSpec(spec);
  const entrypoint =
    spec.procedure.entrypoint === "post_watch" ? "post_watch" : "engage";

  const adapter =
    parsed.adapter ?? resolveFeedbackAdapterFromSpec(spec);

  const { spec: drafted } = compileEngageFromSlots(
    parsed.goal?.trim() || spec.goal,
    {
      entrypoint,
      maxJobs: parsed.maxJobs ?? prior?.maxJobs ?? spec.budget.maxJobs ?? 3,
      dryRun: parsed.dryRun ?? prior?.dryRun ?? spec.budget.dryRun ?? true,
      forceDiscover: parsed.forceDiscover ?? prior?.forceDiscover ?? false,
      allowPromo: parsed.allowPromo ?? prior?.allowPromo ?? true,
      ...(adapter ? { adapter } : {}),
    },
    { intentId: spec.intentId }
  );

  // Preserve identity lineage: new draft then freeze (version resets via createDraftSpec).
  // Prefer thaw+bump when only goal changed without recompile? Recompile is clearer for slots.
  return freezeSpec(
    {
      ...drafted,
      id: spec.id,
      version: spec.version + 1,
      intentId: spec.intentId,
    },
    { frozenBy }
  );
}

/**
 * Ask the human to Approve / Edit / Abort the Spec before stages run.
 * Edit re-freezes a new Spec; Abort cancels the run.
 */
export async function negotiateSpecBeforeRun(opts: {
  adapter: FeedbackAdapter;
  spec: Spec;
  agentId: string;
  frozenBy?: string;
}): Promise<SpecHitlResult> {
  let current = opts.spec;
  // Ensure we present a frozen Spec (caller usually already froze).
  if (current.status === "draft") {
    current = freezeSpec(current, { frozenBy: opts.frozenBy ?? "spec-hitl" });
  }

  const request = buildSpecHitlRequest(current, opts.agentId);
  console.log(`[spec-hitl] presenting Spec ${current.id} for approval`);
  const response = await opts.adapter.present(request);

  if (isAbortResponse(response)) {
    return {
      aborted: true,
      spec: { ...current, status: "aborted" },
      reason: "human aborted Spec before run",
    };
  }

  if (isEditResponse(response)) {
    const edited = applySpecEdit(
      current,
      String(response.value),
      opts.frozenBy ?? "spec-hitl-edit"
    );
    console.log(
      `[spec-hitl] Spec edited → v${edited.version} goal=${edited.goal.slice(0, 80)}`
    );
    return { aborted: false, spec: edited };
  }

  console.log(`[spec-hitl] Spec approved ${current.id}`);
  return { aborted: false, spec: current };
}
