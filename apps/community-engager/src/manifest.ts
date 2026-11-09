import {
  type AgenticAppManifest,
  projectEntrypoint,
  resolveEntrypoint,
} from "@relay/protocol";

/**
 * Nested job manifest: one opportunity, start to finish.
 * Embedded by CommunityEngagerManifest via `stages[].fanout`.
 * Runs in its own AgentRuntime so an abort or failure is scoped to that job.
 */
export const CommunityJobManifest: AgenticAppManifest = {
  name: "CommunityEngagerJob",
  version: "0.1.0",
  description:
    "Draft a reply for one scouted opportunity, pause for human Approve/Edit/Abort, then execute (or manual-notify) and learn.",
  author: "Relay OS Built-in",

  triggers: [
    {
      pattern: "engage thread",
      description: "Run the HITL loop for a single scouted thread",
      examples: ["engage thread", "draft reply for this thread"],
    },
  ],

  capabilities: [
    "community.draft",
    "community.approve",
    "community.execute",
  ],
  engines_required: ["llm", "browser", "data"],
  engines_optional: ["api", "computer"],
  permissions: ["community.reddit.read", "community.reddit.write"],

  stages: [
    {
      name: "draft",
      description: "Draft a reply for this opportunity",
      engine: "llm",
    },
    {
      name: "await_approval",
      description: "Human Approve / Edit / Abort before any post",
      engine: "none",
      feedback_points: [
        {
          type: "approval",
          description:
            "Approve this draft, abort it, or reply edit: <revised text>",
          required: true,
        },
        {
          type: "confirmation",
          description:
            "Intensity 2 confirmation: disclose + UTM intentional?",
          required: true,
        },
      ],
    },
    {
      name: "execute",
      description:
        "Post approved/edited draft (skipped when COMMUNITY_POST_MODE=manual; else REDDIT_DRY_RUN)",
      engine: "browser",
    },
    {
      name: "learn",
      description: "Write HITL outcomes to VoltMem",
      engine: "data",
    },
  ],
  feedback_patterns: [
    "approval",
    "freeform",
    "confirmation",
    "progress",
    "error",
  ],
};

/** Shared jobs fanout stage (engage + post_watch entrypoints). */
const jobsFanoutStage = {
  name: "jobs",
  description:
    "One isolated nested job per opportunity (draft → HITL → execute → learn)",
  engine: "none" as const,
  fanout: {
    manifest: CommunityJobManifest,
    from: "opportunities",
    itemKey: "opportunity",
    mode: "serial" as const,
    // Defaults; CommunityEngagerApp may override via FanoutHost + env
    max: 3,
    delay_ms: 1_500,
  },
};

/**
 * Post-watch pipeline stages (also exposed as `entrypoints.post_watch` on
 * {@link CommunityEngagerManifest}). Kept as a full sibling manifest for docs /
 * discovery until admin reads the entrypoints map.
 */
export const CommunityPostWatchManifest: AgenticAppManifest = {
  name: "CommunityPostWatch",
  version: "0.1.0",
  description:
    "Drain the post-watch queue (24–72h reply/removal checks) and run HITL jobs for follow-up drafts.",
  author: "Relay OS Built-in",

  triggers: [
    {
      pattern: "watch posts",
      description: "Poll enrolled Reddit comments for replies and queue follow-ups",
      examples: ["watch posts", "drain post-watch queue"],
    },
  ],

  capabilities: [
    "community.post_watch",
    "community.draft",
    "community.approve",
    "community.execute",
  ],
  engines_required: ["llm", "data"],
  engines_optional: ["browser", "api", "computer"],
  permissions: ["community.reddit.read", "community.reddit.write"],

  stages: [
    {
      name: "post_watch",
      description:
        "Poll enrolled live posts (24–72h) for replies/removal; set follow-up drafts as opportunities",
      engine: "none",
    },
    jobsFanoutStage,
  ],
  feedback_patterns: [
    "approval",
    "freeform",
    "confirmation",
    "progress",
    "error",
  ],
  composes_with: ["CommunityEngagerJob", "CommunityEngager"],
};

/**
 * Parent engage stages (help + presence lanes share this pipeline;
 * lane kind is stamped via entrypoint → scout).
 */
const engageParentStages: AgenticAppManifest["stages"] = [
    {
      name: "ensure_session",
      description:
        "Ensure Reddit session (browser cookie jar, or Computer Runtime desktop login)",
      engine: "browser",
      feedback_points: [
        {
          type: "credential",
          description:
            "Reddit username and password (reply username on one line, password on the next)",
          required: true,
          timeout_ms: 600_000,
        },
        {
          type: "credential",
          description:
            "Reddit 2FA / email verification code (OTP) if prompted after login",
          required: true,
          timeout_ms: 300_000,
        },
        {
          type: "confirmation",
          description:
            "Computer desktop: finish Reddit login / CAPTCHA in VNC, then Approve (Abort cancels)",
          required: true,
          timeout_ms: 600_000,
        },
      ],
    },
    {
      name: "discover",
      description:
        "Read-only research of candidate fashion/styling subreddits; human must promote before scout can post there",
      engine: "none",
      feedback_points: [
        {
          type: "credential",
          description:
            "Reddit login wall during discover: reply username on line 1, password on line 2",
          required: true,
          timeout_ms: 600_000,
        },
        {
          type: "confirmation",
          description:
            "Reddit anti-bot challenge during discover: solve CAPTCHA in the open browser, then Approve (Abort skips discovery)",
          required: true,
          timeout_ms: 600_000,
        },
        {
          type: "choice",
          description:
            "Promote one discovered subreddit onto the allowlist, or skip",
          required: true,
          timeout_ms: 600_000,
        },
      ],
    },
    {
      name: "scout",
      description:
        "Find actionable Reddit threads; on anti-bot wall, pause for human CAPTCHA in headed browser",
      engine: "browser",
      feedback_points: [
        {
          type: "progress",
          description: "Scouting opportunities…",
          required: false,
        },
        {
          type: "credential",
          description:
            "Reddit login wall during scout: reply username on line 1, password on line 2",
          required: true,
          timeout_ms: 600_000,
        },
        {
          type: "confirmation",
          description:
            "Reddit anti-bot challenge: solve CAPTCHA in the open browser, then Approve (Abort skips jar save)",
          required: true,
          timeout_ms: 600_000,
        },
        {
          type: "choice",
          description:
            "Empty-scout fallback: promote a discovered subreddit onto the allowlist, or skip",
          required: true,
          timeout_ms: 600_000,
        },
      ],
    },
    jobsFanoutStage,
];

/** Create-lane: remodel winners → jobs HITL (notify-only submit). */
const createParentStages: AgenticAppManifest["stages"] = [
  {
    name: "create",
    description:
      "Scout winners on allowsOriginalPosts subs, extract pattern, remodel title+body",
    engine: "llm",
  },
  jobsFanoutStage,
];

/**
 * Parent engage manifest: session + discover + scout, then fan out jobs.
 * Named `post_watch` entrypoint drains the watch queue without scout.
 * Lane entrypoints: engage_help / engage_presence (same stages) + create.
 */
export const CommunityEngagerManifest: AgenticAppManifest = {
  name: "CommunityEngager",
  version: "0.7.0",
  description:
    "Discover fashion/styling subs (HITL promote), scout postable allowlist, run one isolated HITL job per opportunity.",
  author: "Relay OS Built-in",

  triggers: [
    {
      pattern: "engage community",
      description: "Run the community engagement HITL loop",
      examples: ["engage community", "scout reddit for gostylens"],
    },
    {
      pattern: "scout reddit",
      description: "Scout allowlisted subs and draft replies for approval",
      examples: ["scout reddit", "find reddit opportunities"],
    },
  ],

  capabilities: [
    "community.discover",
    "community.scout",
    "community.draft",
    "community.approve",
    "community.execute",
  ],
  engines_required: ["browser", "llm", "data"],
  engines_optional: ["api", "computer"],
  permissions: ["community.reddit.read", "community.reddit.write"],

  stages: engageParentStages,
  entrypoints: {
    engage_help: {
      description:
        "Help-lane engage: advice/systems threads only (same pipeline as default engage).",
      stages: engageParentStages,
      triggers: [
        {
          pattern: "engage help",
          description: "One-off help-lane engage",
          examples: ["engage help", "help lane engage"],
        },
      ],
    },
    engage_presence: {
      description:
        "Presence-lane engage: fit checks / sharp takes (presence score + draft).",
      stages: engageParentStages,
      triggers: [
        {
          pattern: "engage presence",
          description: "One-off presence-lane engage",
          examples: ["engage presence", "presence lane engage"],
        },
      ],
    },
    create: {
      description:
        "Create-lane: propose original posts from remodeled winners (notify-only submit).",
      stages: createParentStages,
      triggers: [
        {
          pattern: "create propose",
          description: "One-off create proposal",
          examples: ["create propose", "propose original post"],
        },
      ],
    },
    post_watch: {
      description: CommunityPostWatchManifest.description,
      stages: CommunityPostWatchManifest.stages,
      triggers: CommunityPostWatchManifest.triggers,
    },
  },
  /**
   * Read by `@relay/scheduler` (`pnpm scheduler`) and the admin Schedules collection.
   * One host; per-lane crons. Presence/create default off until config arms them.
   * Escape hatches: `pnpm start` / `pnpm watch:posts`.
   */
  schedules: [
    {
      id: "cadence",
      entrypoint: "default",
      cron: "0 9,13,18 * * *",
      enabled: true,
      description:
        "Help-lane engage (morning / midday / evening). Daily help/promo caps gate posts; per-fire jobs via cadence.maxJobsPerRun.",
    },
    {
      id: "engage_presence",
      entrypoint: "engage_presence",
      cron: "0 11,16 * * *",
      enabled: false,
      description:
        "Presence-lane engage (default off). Caps via cadence.maxPresencePerDay / maxJobsPerRunPresence.",
    },
    {
      id: "create",
      entrypoint: "create",
      cron: "0 10 * * 3",
      enabled: false,
      description:
        "Create-lane proposal (default off; weekly). Caps via cadence.maxCreatePerWeek / maxJobsPerRunCreate.",
    },
    {
      id: "post_watch",
      entrypoint: "post_watch",
      every_ms: 60 * 60 * 1000,
      enabled: true,
      description:
        "Drain enrolled watches (~hourly): first look ~1h after post, then until maxAge. Host owns the clock.",
    },
  ],
  feedback_patterns: [
    "credential",
    "choice",
    "approval",
    "freeform",
    "confirmation",
    "progress",
    "error",
  ],
  composes_with: ["CommunityEngagerJob", "CommunityPostWatch"],
};

/**
 * App CLI / host names.
 * - `engage` — alias for help lane (protocol default / root stages)
 * - `engage_help` / `engage_presence` — single-kind engage pipelines
 * - `create` — original-post proposals
 * - `post_watch` — post-watch drain
 */
export type CommunityEntrypoint =
  | "engage"
  | "engage_help"
  | "engage_presence"
  | "create"
  | "post_watch";

const ENGAGE_LANE_ENTRYPOINTS = new Set<CommunityEntrypoint>([
  "engage",
  "engage_help",
  "engage_presence",
]);

/** Normalize aliases (`engage` → engage_help for kind purposes stays help). */
export function normalizeCommunityEntrypoint(
  raw: string | undefined | null
): CommunityEntrypoint | undefined {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (!v || v === "default" || v === "engage") return "engage";
  if (v === "engage_help" || v === "help") return "engage_help";
  if (v === "engage_presence" || v === "presence") return "engage_presence";
  if (v === "create" || v === "create_propose") return "create";
  if (v === "post_watch" || v === "postwatch" || v === "watch") return "post_watch";
  return undefined;
}

/** Lane kind stamped on scout drafts for this entrypoint. */
export function engageKindForEntrypoint(
  entrypoint: CommunityEntrypoint
): "help" | "presence" | "create" {
  if (entrypoint === "engage_presence") return "presence";
  if (entrypoint === "create") return "create";
  return "help";
}

export function isEngageLaneEntrypoint(
  entrypoint: CommunityEntrypoint
): boolean {
  return ENGAGE_LANE_ENTRYPOINTS.has(entrypoint);
}

/**
 * Protocol entrypoint key for AgentRuntime (`undefined` = root stages).
 * Help/presence named entrypoints resolve to their map keys (same stage list).
 */
export function protocolEntrypointName(
  entrypoint: CommunityEntrypoint = "engage"
): string | undefined {
  if (entrypoint === "engage") return undefined;
  return entrypoint;
}

/**
 * Flat stages view for the selected pipeline (tests / callers that want
 * only the active stages without the full entrypoints map).
 */
export function manifestForEntrypoint(
  entrypoint: CommunityEntrypoint = "engage"
): AgenticAppManifest {
  return projectEntrypoint(
    CommunityEngagerManifest,
    protocolEntrypointName(entrypoint)
  );
}

/** Resolve stages for an app entrypoint name. */
export function resolveCommunityEntrypoint(entrypoint: CommunityEntrypoint = "engage") {
  return resolveEntrypoint(
    CommunityEngagerManifest,
    protocolEntrypointName(entrypoint)
  );
}
