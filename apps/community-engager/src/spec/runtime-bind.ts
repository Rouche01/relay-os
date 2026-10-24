import { markSpecRunning, type Spec } from "@relay/protocol";

/**
 * Runtime overrides derived from a frozen/running Spec.
 * When Spec is absent or still draft, returns null (legacy env/app options win).
 */
export interface SpecRuntimeBindings {
  /** Cap fanout jobs this run. */
  maxJobs?: number;
  /**
   * When true, force dry-run writes.
   * When false, Spec authorizes live write (env may still dry-run if caller passes undefined).
   * When undefined, do not override env.
   */
  dryRun?: boolean;
  /** Spec requires discover this engage run. */
  forceDiscover: boolean;
  /** When false, intensity ≥ 1 is not authorized. */
  allowPromo: boolean;
}

function constraintIds(spec: Spec): Set<string> {
  return new Set(spec.constraints.map((c) => c.id));
}

/**
 * Read Spec budget + constraint ids into bindings the app/controller can enforce.
 */
export function bindingsFromSpec(
  spec: Spec | undefined | null
): SpecRuntimeBindings | null {
  if (!spec) return null;
  if (spec.status !== "frozen" && spec.status !== "running") {
    return null;
  }

  const ids = constraintIds(spec);
  let dryRun: boolean | undefined;
  if (spec.budget.dryRun === true || ids.has("dry_run_default")) {
    dryRun = true;
  } else if (spec.budget.dryRun === false) {
    dryRun = false;
  }

  return {
    maxJobs:
      typeof spec.budget.maxJobs === "number" && spec.budget.maxJobs >= 0
        ? spec.budget.maxJobs
        : undefined,
    dryRun,
    forceDiscover: ids.has("force_discover"),
    allowPromo: !ids.has("no_promo"),
  };
}

/** Most restrictive maxJobs among Spec, explicit option, and fallback. */
export function resolveMaxJobs(opts: {
  spec?: Spec | null;
  optionMaxJobs?: number;
  fallback: number;
}): number {
  const fromSpec = bindingsFromSpec(opts.spec)?.maxJobs;
  const candidates = [opts.fallback];
  if (opts.optionMaxJobs != null) candidates.push(opts.optionMaxJobs);
  if (fromSpec != null) candidates.push(fromSpec);
  return Math.min(...candidates);
}

/**
 * If Spec is frozen on context, mark it running (idempotent if already running).
 * Returns the Spec to keep on context.
 */
export function activateSpecForRun(spec: Spec | undefined): Spec | undefined {
  if (!spec) return undefined;
  if (spec.status === "running") return spec;
  if (spec.status === "frozen") return markSpecRunning(spec);
  return spec;
}
