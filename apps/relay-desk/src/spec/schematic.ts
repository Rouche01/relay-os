/**
 * Pure schematic model for Design / Activity (desk_spec_workspace_ux w5).
 * Derives from scaffold/validate `body` (+ optional lowered manifest / run).
 * No YAML parser; no `@relay/*` imports — Desk stays HTTP-only (D4).
 */

import type { RunResponse } from "./types.ts";

export type SchematicRunState =
  | "done"
  | "waiting"
  | "simulated"
  | "skipped"
  | "pending"
  | "error";

export type SchematicBadge =
  | { kind: "forEach"; itemsRef: string }
  | { kind: "once"; key: string }
  | { kind: "when"; summary: string }
  | { kind: "retry"; max: number }
  | { kind: "irreversible" }
  | { kind: "hitl" };

export type SchematicNodeKind = "trigger" | "step" | "hitl" | "rules";

export type SchematicNode = {
  id: string;
  kind: SchematicNodeKind;
  /** Plain verb for display (`scout`, `Request`, `Approve`). */
  label: string;
  /** Capability id when kind is step/hitl (`api.request`, `human.approve`). */
  use?: string;
  service?: string;
  operation?: string;
  badges: SchematicBadge[];
  irreversible: boolean;
  /** Rule ids from step.enforce. */
  enforce: string[];
  outputs: string[];
  args?: Record<string, unknown>;
  forEach?: string;
  once?: string;
  when?: unknown;
  retry?: { max: number; backoffMs?: number };
  onError?: string;
  /** Schema / outputs hints for inspector. */
  schema?: unknown;
  runState?: SchematicRunState;
  /** Edge label into this node (ref string). */
  fromRef?: string;
};

export type SchematicRule = {
  id: string;
  kind: string;
  /** Step ids that list this rule in enforce. */
  enforcedBy: string[];
};

export type SchematicEdge = {
  from: string;
  to: string;
  /** Optional dataflow / forEach ref. */
  ref?: string;
};

export type SchematicModel = {
  goal?: string;
  trigger?: SchematicNode;
  steps: SchematicNode[];
  rules: SchematicRule[];
  edges: SchematicEdge[];
  /** Ordered canvas nodes: trigger → steps (HITL steps already in steps). */
  nodes: SchematicNode[];
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/** `api.request` → `Request`; `human.approve` → `Approve`; `llm.generate` → `Generate`. */
export function plainVerbFromUse(use: string): string {
  const part = use.includes(".") ? use.slice(use.lastIndexOf(".") + 1) : use;
  if (!part) return use;
  return part.charAt(0).toUpperCase() + part.slice(1);
}

function isHitlUse(use: string): boolean {
  return use.startsWith("human.");
}

/**
 * Heuristic irreversible flag when descriptor catalog is unavailable.
 * Prefer manifest/evidence later; method + known write verbs cover triage.
 */
export function inferIrreversible(
  use: string,
  args?: Record<string, unknown>
): boolean {
  if (isHitlUse(use)) return false;
  if (
    use === "browser.submit" ||
    use === "computer.act" ||
    use === "data.write" ||
    use === "data.upsert"
  ) {
    return true;
  }
  if (use === "api.request") {
    const method = asString(args?.method)?.toUpperCase();
    if (!method) {
      // Missing method on a write-shaped op name → treat as irreversible
      const op = asString(args?.operation)?.toLowerCase() ?? "";
      if (
        /create|update|delete|post|patch|put|comment|send|write|submit/.test(op)
      ) {
        return true;
      }
      return false;
    }
    return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  }
  return false;
}

function summarizeWhen(when: unknown): string {
  if (typeof when === "string") return when;
  const o = asRecord(when);
  if (!o) return "when";
  if ("eq" in o) return `eq ${String(o.eq)}`;
  if ("ne" in o) return `ne ${String(o.ne)}`;
  if ("in" in o) return `in`;
  if ("exists" in o) return `exists ${String(o.exists)}`;
  return "when";
}

function triggerLabel(trigger: Record<string, unknown>): string {
  if (asRecord(trigger.schedule)) {
    const cron = asString(asRecord(trigger.schedule)?.cron);
    return cron ? `Schedule · ${cron}` : "Schedule";
  }
  if (asRecord(trigger.poll)) {
    const every = asRecord(trigger.poll)?.everyMs;
    return typeof every === "number" ? `Poll · ${every}ms` : "Poll";
  }
  if (trigger.manual === true || asRecord(trigger.manual)) return "Manual";
  return "Trigger";
}

function triggerSummary(trigger: unknown): SchematicNode | undefined {
  const t = asRecord(trigger);
  if (!t) return undefined;
  return {
    id: "trigger",
    kind: "trigger",
    label: triggerLabel(t),
    badges: [],
    irreversible: false,
    enforce: [],
    outputs: [],
    args: t,
  };
}

function stepNodeFromBody(raw: unknown): SchematicNode | undefined {
  const s = asRecord(raw);
  if (!s) return undefined;
  const id = asString(s.id);
  const use = asString(s.use);
  if (!id || !use) return undefined;
  const args = asRecord(s.args);
  const forEach = asString(s.forEach);
  const once = asString(s.once);
  const enforce = asStringArray(s.enforce);
  const outputs = asStringArray(s.outputs);
  const retryRaw = asRecord(s.retry);
  const retry =
    retryRaw && typeof retryRaw.max === "number"
      ? {
          max: retryRaw.max,
          backoffMs:
            typeof retryRaw.backoffMs === "number"
              ? retryRaw.backoffMs
              : undefined,
        }
      : undefined;
  const irreversible = inferIrreversible(use, args);
  const hitl = isHitlUse(use);
  const badges: SchematicBadge[] = [];
  if (forEach) badges.push({ kind: "forEach", itemsRef: forEach });
  if (once) badges.push({ kind: "once", key: once });
  if (s.when !== undefined) {
    badges.push({ kind: "when", summary: summarizeWhen(s.when) });
  }
  if (retry) badges.push({ kind: "retry", max: retry.max });
  if (irreversible) badges.push({ kind: "irreversible" });
  if (hitl) badges.push({ kind: "hitl" });

  return {
    id,
    kind: hitl ? "hitl" : "step",
    label: hitl ? plainVerbFromUse(use) : id,
    use,
    service: asString(args?.service),
    operation: asString(args?.operation),
    badges,
    irreversible,
    enforce,
    outputs,
    args,
    forEach,
    once,
    when: s.when,
    retry,
    onError: asString(s.onError),
    schema: args?.schema,
    fromRef: forEach,
  };
}

function rulesFromBody(
  rulesRaw: unknown,
  steps: SchematicNode[]
): SchematicRule[] {
  const list = Array.isArray(rulesRaw) ? rulesRaw : [];
  const byId = new Map<string, SchematicRule>();
  for (const r of list) {
    const o = asRecord(r);
    const id = asString(o?.id);
    if (!id) continue;
    byId.set(id, {
      id,
      kind: asString(o?.kind) ?? "rule",
      enforcedBy: [],
    });
  }
  for (const step of steps) {
    for (const ruleId of step.enforce) {
      const existing = byId.get(ruleId);
      if (existing) {
        if (!existing.enforcedBy.includes(step.id)) {
          existing.enforcedBy.push(step.id);
        }
      } else {
        byId.set(ruleId, {
          id: ruleId,
          kind: "enforce",
          enforcedBy: [step.id],
        });
      }
    }
  }
  return [...byId.values()];
}

function buildEdges(
  trigger: SchematicNode | undefined,
  steps: SchematicNode[]
): SchematicEdge[] {
  const edges: SchematicEdge[] = [];
  let prev = trigger?.id;
  for (const step of steps) {
    if (prev) {
      edges.push({
        from: prev,
        to: step.id,
        ref: step.forEach,
      });
    }
    prev = step.id;
  }
  return edges;
}

/**
 * Apply run overlay onto step nodes (Activity).
 * Evidence kinds / missing outputs → waiting | simulated | skipped | done.
 */
export function applyRunOverlay(
  model: SchematicModel,
  run?: RunResponse
): SchematicModel {
  if (!run) return model;
  const outputs = run.stepOutputs ?? {};
  const evidence = run.evidence ?? [];
  const simulated = new Set(
    (run.simulatedWrites ?? [])
      .map((w) => asString(w.stepId))
      .filter((id): id is string => Boolean(id))
  );

  const waitingSteps = new Set<string>();
  const skippedSteps = new Set<string>();
  const errorSteps = new Set<string>();
  for (const ev of evidence) {
    const stepId = asString(ev.stepId);
    if (!stepId) continue;
    const kind = asString(ev.kind)?.toLowerCase() ?? "";
    if (
      kind.includes("hitl") ||
      kind.includes("waiting") ||
      kind.includes("paused") ||
      kind === "human"
    ) {
      waitingSteps.add(stepId);
    }
    if (kind.includes("skip")) skippedSteps.add(stepId);
    if (kind.includes("error") || kind.includes("fail")) errorSteps.add(stepId);
  }

  if (
    run.state === "paused" ||
    run.state === "waiting_human" ||
    run.state === "waiting_you"
  ) {
    for (const step of model.steps) {
      if (step.kind === "hitl") waitingSteps.add(step.id);
    }
  }

  const steps = model.steps.map((step) => {
    let runState: SchematicRunState = "pending";
    if (errorSteps.has(step.id)) runState = "error";
    else if (waitingSteps.has(step.id)) runState = "waiting";
    else if (skippedSteps.has(step.id)) runState = "skipped";
    else if (simulated.has(step.id)) runState = "simulated";
    else if (step.id in outputs) runState = "done";
    else if (run.ok && Object.keys(outputs).length > 0) {
      // After a completed prior step with no output key — treat as skipped if later steps ran
      const ids = model.steps.map((s) => s.id);
      const idx = ids.indexOf(step.id);
      const laterDone = ids
        .slice(idx + 1)
        .some((id) => id in outputs || simulated.has(id));
      runState = laterDone ? "skipped" : "pending";
    }
    return { ...step, runState };
  });

  const trigger = model.trigger
    ? {
        ...model.trigger,
        runState: (run.ok || run.runId ? "done" : "pending") as SchematicRunState,
      }
    : undefined;

  return {
    ...model,
    trigger,
    steps,
    nodes: [...(trigger ? [trigger] : []), ...steps],
  };
}

/**
 * Mark irreversible from lowered manifest stage metadata when present.
 * Looks for stage/step ids with sideEffect / irreversible flags.
 */
function applyManifestIrreversible(
  steps: SchematicNode[],
  manifest: unknown
): SchematicNode[] {
  const m = asRecord(manifest);
  if (!m) return steps;
  const irreversibleIds = new Set<string>();

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const o = asRecord(value);
    if (!o) return;
    const id = asString(o.id) ?? asString(o.stepId);
    const side =
      asString(o.sideEffect) ??
      asString(o.side_effect) ??
      asString(o.defaultSideEffect);
    if (
      id &&
      (side === "irreversible" ||
        o.irreversible === true ||
        o.requiresHitlWhenIrreversible === true)
    ) {
      irreversibleIds.add(id);
    }
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") walk(v);
    }
  };
  walk(m.stages ?? m.steps ?? m);

  if (irreversibleIds.size === 0) return steps;
  return steps.map((step) => {
    if (!irreversibleIds.has(step.id) || step.irreversible) return step;
    const badges = step.badges.some((b) => b.kind === "irreversible")
      ? step.badges
      : [...step.badges, { kind: "irreversible" as const }];
    return { ...step, irreversible: true, badges };
  });
}

export type DeriveSchematicInput = {
  /** Parsed Spec body from scaffold/validate. */
  body?: unknown;
  /** Lowered AgenticManifest (optional irreversible enrichment). */
  manifest?: unknown;
  /** Run overlay for Activity. */
  run?: RunResponse;
};

/** Derive a read-only schematic model from Spec body (+ optional manifest/run). */
export function deriveSchematic(input: DeriveSchematicInput): SchematicModel {
  const body = asRecord(input.body) ?? {};
  const goal = asString(body.goal);
  const trigger = triggerSummary(body.trigger);
  const rawSteps = Array.isArray(body.steps) ? body.steps : [];
  let steps = rawSteps
    .map(stepNodeFromBody)
    .filter((n): n is SchematicNode => Boolean(n));
  steps = applyManifestIrreversible(steps, input.manifest);
  const rules = rulesFromBody(body.rules, steps);
  const edges = buildEdges(trigger, steps);
  const base: SchematicModel = {
    goal,
    trigger,
    steps,
    rules,
    edges,
    nodes: [...(trigger ? [trigger] : []), ...steps],
  };
  return applyRunOverlay(base, input.run);
}

/** Irreversible step ids — for Verify risk callout (w7). */
export function irreversibleSteps(model: SchematicModel): SchematicNode[] {
  return model.steps.filter((s) => s.irreversible);
}
