/**
 * Offline draft-eval cases: thread fit + humanity checks.
 * Built from fixtures plus a few media / thin-body / product-tempting posts.
 */

import type { EngageKind } from "../types.js";

export interface DraftEvalCase {
  id: string;
  subreddit: string;
  threadTitle: string;
  opText: string;
  opMediaHint?: string;
  /** Lane — presence uses short-take voice + intensity 0. Default help. */
  kind?: EngageKind;
  /** Distinctive tokens that should show up (title paraphrase is enough). */
  mustGroundIn: string[];
  /** Extra bans beyond the shared AI-tell list. */
  bannedPhrases?: string[];
  /** Soft ceiling on intensity after drafting. */
  maxIntensity?: 0 | 1 | 2;
  /** Force help-only (warmup / promo block). */
  forceIntensity0?: boolean;
  /** Starting intensity hint for the skeleton. */
  intensity?: 0 | 1 | 2;
}

export const DRAFT_EVAL_CASES: DraftEvalCase[] = [
  {
    id: "fx-capsule-wardrobe",
    subreddit: "femalefashionadvice",
    threadTitle: "How do you build a work capsule when nothing fits the same?",
    opText:
      "I keep buying pieces that don't work together. Looking for a simple system, not brand recs.",
    mustGroundIn: ["capsule", "work"],
    maxIntensity: 0,
    forceIntensity0: true,
    intensity: 0,
  },
  {
    id: "fx-color-season",
    subreddit: "fashion",
    threadTitle: "Is color analysis worth it or just TikTok fluff?",
    opText:
      "Curious if anyone actually uses season analysis to shop, or if I should ignore it.",
    mustGroundIn: ["color", "analysis"],
    maxIntensity: 1,
    intensity: 1,
  },
  {
    id: "media-live-taping",
    subreddit: "malefashionadvice",
    threadTitle: "Help styling these for a live taping",
    opText: "",
    opMediaHint:
      "OP included photo(s) on the thread. Ground the reply in the title/body; you cannot see the pixels.",
    mustGroundIn: ["taping"],
    bannedPhrases: ["from the pic, yeah", "from the pics, yeah"],
    maxIntensity: 0,
    forceIntensity0: true,
    intensity: 0,
  },
  {
    id: "thin-pleated-trousers",
    subreddit: "femalefashionadvice",
    threadTitle: "Pleated dress trousers — casual office ok?",
    opText: "Budget under $150. Not sure flat front vs pleats.",
    mustGroundIn: ["pleat", "office"],
    bannedPhrases: ["you'd want", "check out"],
    maxIntensity: 0,
    forceIntensity0: true,
    intensity: 0,
  },
  {
    id: "product-tempt-system",
    subreddit: "femalefashionadvice",
    threadTitle: "Need a system for outfits that work together",
    opText:
      "I need a process for outfits that work together. Looking for advice, not a haul.",
    mustGroundIn: ["system", "outfit"],
    maxIntensity: 0,
    forceIntensity0: true,
    intensity: 1,
  },
  {
    id: "warehouse-tees",
    subreddit: "malefashionadvice",
    threadTitle: "Thick work Tshirts for warehouse shifts?",
    opText:
      "Warehouse shift, need thicker tees that don't shred. Comfort over fashion.",
    mustGroundIn: ["warehouse", "tshirt"],
    maxIntensity: 0,
    forceIntensity0: true,
    intensity: 0,
  },
  {
    id: "wedding-guest-thin",
    subreddit: "femalefashionadvice",
    threadTitle: "Wedding guest, outdoor, mid-70s",
    opText: "Any silhouette tips? No dress code beyond semi-formal.",
    mustGroundIn: ["wedding", "outdoor"],
    maxIntensity: 0,
    forceIntensity0: true,
    intensity: 0,
  },
  {
    id: "budget-sneakers",
    subreddit: "malefashionadvice",
    threadTitle: "Daily sneakers under $100 that don't look gym",
    opText: "Walking a lot for commute. Prefer leather or leather-like.",
    mustGroundIn: ["sneaker", "100"],
    bannedPhrases: ["check out", "game changer"],
    maxIntensity: 0,
    forceIntensity0: true,
    intensity: 0,
  },
  {
    id: "presence-fit-check",
    kind: "presence",
    subreddit: "malefashionadvice",
    threadTitle: "Fit check — navy trousers + white tee for drinks?",
    opText: "Too casual? Honest thoughts welcome.",
    opMediaHint:
      "OP included photo(s) on the thread. Ground the reply in the title/body; you cannot see the pixels.",
    mustGroundIn: ["drink", "tee"],
    bannedPhrases: ["gostylens", "happy to help", "from the pic"],
    maxIntensity: 0,
    forceIntensity0: true,
    intensity: 0,
  },
  {
    id: "presence-rate-outfit",
    kind: "presence",
    subreddit: "fashion",
    threadTitle: "Rate the outfit — wedding guest, outdoor",
    opText: "Semi-formal outdoor wedding. Does the silhouette work?",
    mustGroundIn: ["wedding", "outdoor"],
    bannedPhrases: ["gostylens", "game changer", "check out"],
    maxIntensity: 0,
    forceIntensity0: true,
    intensity: 0,
  },
  {
    id: "presence-hot-take",
    kind: "presence",
    subreddit: "femalefashionadvice",
    threadTitle: "Are oversized blazers over for work or still fine?",
    opText: "Office dressy-casual. Curious what people are actually wearing.",
    mustGroundIn: ["blazer", "work"],
    bannedPhrases: ["gostylens", "simple approach", "feel free to"],
    maxIntensity: 0,
    forceIntensity0: true,
    intensity: 0,
  },
];
