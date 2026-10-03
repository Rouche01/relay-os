import { AgenticAppManifest } from "@relay/protocol";

export const CommunityEngagerManifest: AgenticAppManifest = {
  name: "CommunityEngager",
  version: "0.1.0",
  description:
    "Scout Reddit fashion/styling threads, draft helpful replies, pause for human Approve/Edit/Abort, then execute.",
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
    "community.scout",
    "community.draft",
    "community.approve",
    "community.execute",
  ],
  engines_required: ["browser", "api", "llm", "data"],
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
      name: "scout",
      description: "Find actionable Reddit threads (live allowlist or fixtures)",
      engine: "browser",
      feedback_points: [
        {
          type: "progress",
          description: "Scouting opportunities…",
          required: false,
        },
      ],
    },
    {
      name: "draft",
      description: "Draft a helpful reply for the top actionable opportunity",
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
    "credential",
    "approval",
    "freeform",
    "progress",
    "confirmation",
    "error",
  ],
};
