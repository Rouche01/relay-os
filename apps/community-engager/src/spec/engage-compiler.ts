import {
  createDraftSpec,
  createIntent,
  markIntentCompiled,
  type Intent,
  type IntentSlots,
  type Spec,
  type SpecAcceptanceItem,
  type SpecAllowedAction,
  type SpecConstraint,
  type SpecHitlRequirement,
} from "@relay/protocol";
import type { CommunityEntrypoint } from "../manifest.js";

/** Stable app id for Spec.procedure.appId */
export const COMMUNITY_ENGAGER_APP_ID = "community-engager";

/** Known Intent.slots keys for engage / post_watch template fill. */
export type EngageIntentSlotKey =
  | "entrypoint"
  | "maxJobs"
  | "dryRun"
  | "forceDiscover"
  | "allowPromo";

export type EngageCompileOptions = {
  /** Defaults from env/app when slots omit a value. */
  defaults?: {
    entrypoint?: CommunityEntrypoint;
    maxJobs?: number;
    dryRun?: boolean;
    forceDiscover?: boolean;
    allowPromo?: boolean;
  };
  /** Spec id override (tests). */
  specId?: string;
  intentId?: string;
};

export type EngageCompileResult = {
  intent: Intent;
  spec: Spec;
};

function slotString(slots: IntentSlots, key: string): string | undefined {
  const v = slots[key];
  if (v === undefined || v === null) return undefined;
  return String(v).trim();
}

function slotBool(
  slots: IntentSlots,
  key: string,
  fallback: boolean
): boolean {
  const v = slots[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

function slotNumber(
  slots: IntentSlots,
  key: string,
  fallback: number
): number {
  const v = slots[key];
  if (v === undefined || v === null || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function resolveEntrypoint(
  slots: IntentSlots,
  fallback: CommunityEntrypoint
): CommunityEntrypoint {
  const raw = slotString(slots, "entrypoint")?.toLowerCase().replace(/-/g, "_");
  if (raw === "post_watch" || raw === "postwatch" || raw === "watch") {
    return "post_watch";
  }
  if (raw === "engage" || raw === "scout" || raw === "community") {
    return "engage";
  }
  return fallback;
}

function buildAllowedActions(opts: {
  entrypoint: CommunityEntrypoint;
  allowPromo: boolean;
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

  if (!opts.allowPromo) {
    // Still listed but constrained — acceptance + constraints enforce intensity.
  }

  return actions;
}

function buildConstraints(opts: {
  entrypoint: CommunityEntrypoint;
  maxJobs: number;
  dryRun: boolean;
  forceDiscover: boolean;
  allowPromo: boolean;
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
      description: "REDDIT_DRY_RUN / dry-run: no live write unless Spec thawed and budget flipped",
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
  return out;
}

function buildAcceptance(opts: {
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
      description: "Post-watch poll finished with opportunity list (maybe empty)",
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
      description: "Human Approve / Edit / Abort recorded for each job that reached await_approval",
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
      description: "If intensity 2, confirmation HITL completed before execute",
      kind: "human",
    });
  }
  return items;
}

function buildHitlRequired(opts: { allowPromo: boolean }): SpecHitlRequirement[] {
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

function goalForEntrypoint(
  entrypoint: CommunityEntrypoint,
  userGoal: string
): string {
  const trimmed = userGoal.trim();
  if (trimmed) return trimmed;
  return entrypoint === "post_watch"
    ? "Watch enrolled community posts and draft follow-ups under HITL"
    : "Scout allowlisted communities and draft helpful replies under HITL";
}

/**
 * Template-fill Intent → draft Spec for CommunityEngager.
 * Does not invent stages — binds `procedure` to engage or post_watch manifests.
 */
export function compileEngageIntent(
  intentOrGoal: Intent | string,
  options: EngageCompileOptions = {}
): EngageCompileResult {
  const defaults = options.defaults ?? {};
  const intent: Intent =
    typeof intentOrGoal === "string"
      ? createIntent({
          goal: intentOrGoal,
          id: options.intentId,
          slots: {},
        })
      : intentOrGoal;

  const slots = intent.slots;
  const entrypoint = resolveEntrypoint(
    slots,
    defaults.entrypoint ?? "engage"
  );
  const maxJobs = slotNumber(slots, "maxJobs", defaults.maxJobs ?? 3);
  const dryRun = slotBool(slots, "dryRun", defaults.dryRun ?? true);
  const forceDiscover = slotBool(
    slots,
    "forceDiscover",
    defaults.forceDiscover ?? false
  );
  const allowPromo = slotBool(slots, "allowPromo", defaults.allowPromo ?? true);

  const spec = createDraftSpec({
    id: options.specId,
    intentId: intent.id,
    goal: goalForEntrypoint(entrypoint, intent.goal),
    procedure: {
      appId: COMMUNITY_ENGAGER_APP_ID,
      entrypoint,
    },
    actionBinding: "browser",
    constraints: buildConstraints({
      entrypoint,
      maxJobs,
      dryRun,
      forceDiscover,
      allowPromo,
    }),
    allowedActions: buildAllowedActions({ entrypoint, allowPromo }),
    acceptance: buildAcceptance({ entrypoint, dryRun, allowPromo }),
    hitlRequired: buildHitlRequired({ allowPromo }),
    budget: {
      maxJobs,
      dryRun,
    },
  });

  const compiledIntent = markIntentCompiled(intent, spec.id);
  return { intent: compiledIntent, spec };
}

/**
 * Convenience: build Intent from goal + slots, then compile.
 */
export function compileEngageFromSlots(
  goal: string,
  slots: IntentSlots = {},
  options: EngageCompileOptions = {}
): EngageCompileResult {
  const intent = createIntent({
    goal,
    slots,
    id: options.intentId,
  });
  return compileEngageIntent(intent, options);
}
