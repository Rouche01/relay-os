import { freezeSpec, type Spec } from "@relay/protocol";
import {
  compileEngageFromSlots,
  type EngageCompileOptions,
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
  frozenBy?: string;
  /** When false, return draft Spec (tests). Default true. */
  freeze?: boolean;
};

/**
 * Compile + optionally freeze a Spec for a CommunityEngager run from
 * current env defaults (dry-run, max jobs) and optional overrides.
 */
export function buildRunSpec(opts: BuildRunSpecOptions = {}): Spec {
  const cfg = getCommunityConfig();
  const entrypoint = opts.entrypoint ?? "engage";
  const compileOpts: EngageCompileOptions = {
    defaults: {
      entrypoint,
      maxJobs: opts.maxJobs ?? cfg.jobs.maxJobs,
      dryRun: opts.dryRun ?? cfg.reddit.dryRun,
      forceDiscover: opts.forceDiscover ?? false,
      allowPromo: opts.allowPromo ?? true,
    },
  };

  const goal =
    opts.goal?.trim() ||
    (entrypoint === "post_watch"
      ? "Watch enrolled posts and draft follow-ups under HITL"
      : "Scout allowlisted communities and draft helpful replies under HITL");

  const { spec } = compileEngageFromSlots(
    goal,
    {
      entrypoint,
      maxJobs: compileOpts.defaults!.maxJobs!,
      dryRun: compileOpts.defaults!.dryRun!,
      forceDiscover: compileOpts.defaults!.forceDiscover!,
      allowPromo: compileOpts.defaults!.allowPromo!,
    },
    compileOpts
  );

  if (opts.freeze === false) return spec;
  return freezeSpec(spec, {
    frozenBy: opts.frozenBy ?? "cli",
  });
}
