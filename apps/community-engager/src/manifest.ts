import { AgenticAppManifest } from "@relay/protocol";

/**
 * Nested job manifest: one opportunity, start to finish.
 * Embedded by CommunityEngagerManifest via `stages[].fanout`.
 * Runs in its own AgentRuntime so an abort or failure is scoped to that job.
 */
export const CommunityJobManifest: AgenticAppManifest = {
  name: "CommunityEngagerJob",
  version: "0.1.0",
  description:
    "Draft a reply for one scouted opportunity, pause for human Approve/Edit/Abort, then execute and learn.",
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
  engines_optional: ["api"],
  permissions: ["community.reddit.read", "community.reddit.write"],

  stages: [
    {
      name: "draft",
      description: "Draft a helpful reply for this opportunity",
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
        "Post approved/edited draft (REDDIT_DRY_RUN=true by default)",
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
 * Parent engage manifest: session + discover + scout, then fan out jobs.
 * Post-watch lives on {@link CommunityPostWatchManifest} (separate entrypoint).
 */
export const CommunityEngagerManifest: AgenticAppManifest = {
  name: "CommunityEngager",
  version: "0.5.0",
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
  engines_optional: ["api"],
  permissions: ["community.reddit.read", "community.reddit.write"],

  stages: [
    {
      name: "ensure_session",
      description:
        "Ensure Reddit browser cookie jar (skip if present; else HITL credential login or env)",
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
      ],
    },
    jobsFanoutStage,
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
 * Post-watch entrypoint: poll enrolled live posts, then fan out follow-up jobs.
 * No session/discover/scout — public .json polls only. Enroll still happens on engage execute.
 * Run via CLI `--entrypoint post_watch` (scheduler host comes later).
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
  engines_optional: ["browser", "api"],
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

/** Named entrypoints until protocol-level `entrypoints` map lands. */
export type CommunityEntrypoint = "engage" | "post_watch";

export function manifestForEntrypoint(
  entrypoint: CommunityEntrypoint = "engage"
): AgenticAppManifest {
  return entrypoint === "post_watch"
    ? CommunityPostWatchManifest
    : CommunityEngagerManifest;
}
