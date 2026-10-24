import { freezeSpec, type Intent, type Spec } from "@relay/protocol";
import {
  compileEngageFromSlots,
  type EngageCompileOptions,
  type FeedbackAdapterKind,
  resolveFeedbackAdapterFromSpec,
  resolveFeedbackAdapterSlot,
} from "./engage-compiler.js";
import type { CommunityEntrypoint } from "../manifest.js";
import { getCommunityConfig } from "../reddit/config.js";

export type BuildRunSpecOptions = {
  goal?: string;
  entrypoint?: CommunityEntrypoint;
  maxJobs?: number;
  dryRun?: boolean;
  forceDiscover?: boolean;
  allowPromo?: boolean;
  /** Intent slot: which HITL adapter the host should use. */
  adapter?: FeedbackAdapterKind;
  frozenBy?: string;
  /** When false, return draft Spec (tests). Default true. */
  freeze?: boolean;
};

export type BuildRunSpecBundle = {
  intent: Intent;
  spec: Spec;
  /** Resolved adapter from slots / options (cli | telegram). */
  adapter?: FeedbackAdapterKind;
};

/**
 * Compile + optionally freeze a Spec for a CommunityEngager run from
 * current env defaults (dry-run, max jobs) and optional overrides.
 */
export function buildRunSpec(opts: BuildRunSpecOptions = {}): Spec {
  return buildRunSpecBundle(opts).spec;
}

/** Same as {@link buildRunSpec}, also returns Intent + resolved adapter slot. */
export function buildRunSpecBundle(
  opts: BuildRunSpecOptions = {}
): BuildRunSpecBundle {
  const cfg = getCommunityConfig();
  const entrypoint = opts.entrypoint ?? "engage";
  const compileOpts: EngageCompileOptions = {
    defaults: {
      entrypoint,
      maxJobs: opts.maxJobs ?? cfg.jobs.maxJobs,
      dryRun: opts.dryRun ?? cfg.reddit.dryRun,
      forceDiscover: opts.forceDiscover ?? false,
      allowPromo: opts.allowPromo ?? true,
      adapter: opts.adapter,
    },
  };

  const goal =
    opts.goal?.trim() ||
    (entrypoint === "post_watch"
      ? "Watch enrolled posts and draft follow-ups under HITL"
      : "Scout allowlisted communities and draft helpful replies under HITL");

  const slots = {
    entrypoint,
    maxJobs: compileOpts.defaults!.maxJobs!,
    dryRun: compileOpts.defaults!.dryRun!,
    forceDiscover: compileOpts.defaults!.forceDiscover!,
    allowPromo: compileOpts.defaults!.allowPromo!,
    ...(opts.adapter ? { adapter: opts.adapter } : {}),
  };

  const { intent, spec: draft } = compileEngageFromSlots(
    goal,
    slots,
    compileOpts
  );

  const spec =
    opts.freeze === false
      ? draft
      : freezeSpec(draft, {
          frozenBy: opts.frozenBy ?? opts.adapter ?? "cli",
        });

  const adapter =
    resolveFeedbackAdapterSlot(intent.slots, opts.adapter) ??
    resolveFeedbackAdapterFromSpec(spec);

  return { intent, spec, adapter };
}
