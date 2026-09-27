import type { CommunityDraft, OpportunityScore } from "../types.js";

/** Mock Reddit threads for offline HITL dogfood. */
export interface FixtureThread {
  id: string;
  subreddit: string;
  threadUrl: string;
  threadTitle: string;
  /** OP body excerpt used by the stub drafter */
  opText: string;
  score: OpportunityScore;
  rationale: string;
  /** Default intensity 0–1 for fixtures */
  intensity: 0 | 1;
}

export const FIXTURE_THREADS: FixtureThread[] = [
  {
    id: "fx-capsule-wardrobe",
    subreddit: "femalefashionadvice",
    threadUrl: "https://reddit.com/r/femalefashionadvice/comments/fixture1",
    threadTitle: "How do you build a work capsule when nothing fits the same?",
    opText:
      "I keep buying pieces that don't work together. Looking for a simple system, not brand recs.",
    score: {
      problemFit: true,
      wantsHelp: true,
      rulesOk: true,
      freshnessOk: true,
      valueWithoutApp: true,
    },
    rationale: "Clear system ask; soft mention OK; high problem fit.",
    intensity: 0,
  },
  {
    id: "fx-color-season",
    subreddit: "fashion",
    threadUrl: "https://reddit.com/r/fashion/comments/fixture2",
    threadTitle: "Is color analysis worth it or just TikTok fluff?",
    opText:
      "Curious if anyone actually uses season analysis to shop, or if I should ignore it.",
    score: {
      problemFit: true,
      wantsHelp: true,
      rulesOk: true,
      freshnessOk: true,
      valueWithoutApp: false,
    },
    rationale: "Good fit but weaker value-without-app; still actionable at 4/5.",
    intensity: 1,
  },
  {
    id: "fx-spammy-haul",
    subreddit: "OUTFITS",
    threadUrl: "https://reddit.com/r/OUTFITS/comments/fixture3",
    threadTitle: "Rate my thrift haul 🔥",
    opText: "Just showing off finds, no questions.",
    score: {
      problemFit: false,
      wantsHelp: false,
      rulesOk: true,
      freshnessOk: true,
      valueWithoutApp: false,
    },
    rationale: "Not actionable — no help ask.",
    intensity: 0,
  },
];

export function fixtureToDraftSkeleton(thread: FixtureThread): Omit<
  CommunityDraft,
  "draftText" | "status"
> & { draftText: string; status: CommunityDraft["status"] } {
  return {
    id: thread.id,
    platform: "reddit",
    subreddit: thread.subreddit,
    threadUrl: thread.threadUrl,
    threadTitle: thread.threadTitle,
    draftText: "",
    intensity: thread.intensity,
    score: thread.score,
    rationale: thread.rationale,
    status: "proposed",
    createdAt: new Date().toISOString(),
    utmCampaign: "community_fixture",
  };
}
