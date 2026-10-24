import type {
  SpecAcceptanceItem,
  SpecAllowedAction,
  SpecConstraint,
  SpecHitlRequirement,
} from "@relay/protocol";
import type { CommunityEntrypoint } from "../manifest.js";
import type { FeedbackAdapterKind } from "./engage-slots.js";

/** Domain-free primitives for compose (plus pack aliases below). */
export function buildPrimitiveActions(): SpecAllowedAction[] {
  return [
    {
      id: "observe",
      description: "Read world state (allowlist, queue, page, memory)",
      sideEffect: "none",
      actionBinding: "browser",
    },
    {
      id: "read",
      description: "Fetch a specific artifact or record",
      sideEffect: "none",
      actionBinding: "protocol",
    },
    {
      id: "navigate",
      description: "Move browser focus / context (URL, surface)",
      sideEffect: "none",
      actionBinding: "browser",
    },
    {
      id: "invoke",
      description: "Call a Spec-shaped capability (scout, draft, tools)",
      sideEffect: "reversible",
      actionBinding: "browser",
    },
    {
      id: "assert",
      description: "Check acceptance / evidence gates",
      sideEffect: "none",
      actionBinding: "protocol",
    },
    {
      id: "wait_human",
      description: "HITL Approve / Edit / Abort (Spec or draft)",
      sideEffect: "none",
      actionBinding: "protocol",
    },
    {
      id: "write",
      description: "Irreversible external mutate (post comment, etc.)",
      sideEffect: "irreversible",
      actionBinding: "browser",
    },
  ];
}

/** Legacy / manifest stage aliases — kept so CommunityEngager runtime still binds. */
export function buildAliasActions(opts: {
  entrypoint: CommunityEntrypoint;
}): SpecAllowedAction[] {
  const actions: SpecAllowedAction[] = [];
  if (opts.entrypoint === "engage") {
    actions.push(
      {
        id: "ensure_session",
        description: "Establish Reddit session (jar / HITL login)",
        sideEffect: "none",
        actionBinding: "browser",
      },
      {
        id: "discover_subs",
        description: "Research candidate subreddits; promote only after HITL",
        sideEffect: "reversible",
        actionBinding: "browser",
      },
      {
        id: "scout_threads",
        description: "Find actionable threads on the postable allowlist",
        sideEffect: "none",
        actionBinding: "browser",
      }
    );
  } else {
    actions.push({
      id: "post_watch",
      description: "Poll enrolled posts for follow-up opportunities",
      sideEffect: "none",
      actionBinding: "browser",
    });
  }

  actions.push(
    {
      id: "draft_reply",
      description: "Draft a community reply (LLM or stub)",
      sideEffect: "none",
      actionBinding: "protocol",
    },
    {
      id: "post_comment",
      description: "Submit approved comment (or dry-run / manual notify)",
      sideEffect: "irreversible",
      actionBinding: "browser",
    },
    {
      id: "learn_outcome",
      description: "Persist HITL outcome to VoltMem",
      sideEffect: "reversible",
      actionBinding: "protocol",
    }
  );

  return actions;
}

export function buildAllowedActions(opts: {
  entrypoint: CommunityEntrypoint;
  allowPromo: boolean;
}): SpecAllowedAction[] {
  void opts.allowPromo;
  return [...buildPrimitiveActions(), ...buildAliasActions(opts)];
}

export function buildConstraints(opts: {
  entrypoint: CommunityEntrypoint;
  maxJobs: number;
  dryRun: boolean;
  forceDiscover: boolean;
  allowPromo: boolean;
  adapter?: FeedbackAdapterKind;
}): SpecConstraint[] {
  const out: SpecConstraint[] = [
    {
      id: "allowlist_only",
      description:
        "Only scout/post on allowlisted (postable) subs unless discover HITL promotes",
    },
    {
      id: "max_jobs",
      description: `At most ${opts.maxJobs} opportunity job(s) this run`,
    },
    {
      id: "hitl_before_post",
      description: "Never post without Approve (Edit allowed; Abort stops write)",
    },
  ];
  if (opts.dryRun) {
    out.push({
      id: "dry_run_default",
      description:
        "REDDIT_DRY_RUN / dry-run: no live write unless Spec thawed and budget flipped",
    });
  }
  if (opts.entrypoint === "engage" && opts.forceDiscover) {
    out.push({
      id: "force_discover",
      description: "Force discover research this run (engage_discover)",
    });
  }
  if (!opts.allowPromo) {
    out.push({
      id: "no_promo",
      description: "Intensity ≥ 1 (promo / soft CTA) not authorized this Spec",
    });
  } else {
    out.push({
      id: "intensity2_confirm",
      description:
        "Intensity 2 requires extra confirmation (disclose + UTM intentional)",
    });
  }
  if (opts.adapter === "telegram") {
    out.push({
      id: "hitl_adapter_telegram",
      description: "Human negotiation via Telegram adapter",
    });
  } else if (opts.adapter === "cli") {
    out.push({
      id: "hitl_adapter_cli",
      description: "Human negotiation via CLI adapter",
    });
  }
  return out;
}

export function buildAcceptance(opts: {
  entrypoint: CommunityEntrypoint;
  dryRun: boolean;
  allowPromo: boolean;
}): SpecAcceptanceItem[] {
  const items: SpecAcceptanceItem[] = [];
  if (opts.entrypoint === "engage") {
    items.push({
      id: "scout_complete",
      description: "Scout finished (opportunities and/or empty with report)",
      kind: "gate",
    });
  } else {
    items.push({
      id: "post_watch_complete",
      description:
        "Post-watch poll finished with opportunity list (maybe empty)",
      kind: "gate",
    });
  }
  items.push(
    {
      id: "draft_present",
      description: "Each running job has a draft artifact before HITL",
      kind: "artifact",
    },
    {
      id: "hitl_decision",
      description:
        "Human Approve / Edit / Abort recorded for each job that reached await_approval",
      kind: "human",
    },
    {
      id: "execute_evidence",
      description: opts.dryRun
        ? "Execute produced dry-run / would-post evidence (no silent live post)"
        : "Execute produced post or manual-notify evidence for approved jobs",
      kind: "artifact",
    }
  );
  if (opts.allowPromo) {
    items.push({
      id: "intensity2_gate",
      description:
        "If intensity 2, confirmation HITL completed before execute",
      kind: "human",
    });
  }
  return items;
}

export function buildHitlRequired(opts: {
  allowPromo: boolean;
}): SpecHitlRequirement[] {
  const items: SpecHitlRequirement[] = [
    {
      id: "freeze_optional",
      description: "Prefer human freeze of Spec before run (demo / production)",
      when: "before_run",
    },
    {
      id: "before_post",
      description: "Negotiate draft before irreversible post_comment",
      when: "before_irreversible",
    },
    {
      id: "discover_promote",
      description: "Discover promote/skip is HITL when discover runs",
      when: "on_discover_choice",
    },
  ];
  if (opts.allowPromo) {
    items.push({
      id: "intensity2",
      description: "Confirm disclose + UTM for intensity-2 drafts",
      when: "before_irreversible_intensity2",
    });
  }
  return items;
}

export function goalForEntrypoint(
  entrypoint: CommunityEntrypoint,
  userGoal: string
): string {
  const trimmed = userGoal.trim();
  if (trimmed) return trimmed;
  return entrypoint === "post_watch"
    ? "Watch enrolled community posts and draft follow-ups under HITL"
    : "Scout allowlisted communities and draft helpful replies under HITL";
}
