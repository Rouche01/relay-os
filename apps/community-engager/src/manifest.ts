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
  engines_required: ["api", "llm", "data"],
  permissions: ["community.reddit.read", "community.reddit.write"],

  stages: [
    {
      name: "scout",
      description: "Find actionable Reddit threads (fixtures offline)",
      engine: "api",
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
      ],
    },
    {
      name: "execute",
      description: "Post the approved/edited draft (dry-run until Reddit write is wired)",
      engine: "api",
    },
    {
      name: "learn",
      description: "Record outcome for later VoltMem (noop stub)",
      engine: "data",
    },
  ],

  feedback_patterns: ["approval", "freeform", "progress", "confirmation", "error"],
};
