import {
  ACTIONABLE_SCORE_MIN,
  PRESENCE_ACTIONABLE_MIN,
  PRESENCE_SCORE_MAX,
  SCORE_MAX,
  type OpportunityScore,
  type PresenceScore,
} from "../../types.js";
import type { SubredditPlaybook } from "../../policy/playbook.js";
import { getSubredditPolicy } from "../config.js";
import type { RedditListingPost } from "../client.js";

export const HELP_RE =
  /\b(how (do|can|should)|advice|help|tips?|suggest|recommend|looking for|struggle|can't figure|build a|capsule|system|wardrobe)\b/i;
const QUESTION_RE = /\?/;
const BRAND_ONLY_RE = /\b(what brand|best brand|buy this|haul)\b/i;
/** Presence: brand wars only — do not treat “haul” / fit-check language as brand-only. */
const BRAND_WAR_RE = /\b(what brand|best brand|buy this|which brand)\b/i;
/** Sticky / recurring threads that look like “help” but aren’t single-OP opportunities. */
export const MEGATHREAD_RE =
  /\b(daily questions?\s+thread|weekly\s+questions|megathread|simple questions?\s+thread|outfit feedback thread|waywt)\b/i;

/** GoStylens ICP: wardrobe systems, planning, fit/shopping paralysis — not haul/flex. */
export const ICP_RE =
  /\b(capsule|wardrobe|closet|outfit plan|what to wear|style system|shopping paralysis|decision fatigue|build a (wardrobe|capsule)|pieces that (work|go) together|cohesive|capsulewardrobe|fit (issues|problem)|dress for (work|body)|organize (my )?(closet|wardrobe))\b/i;

/** Soft plug would feel natural: wants a system/tool/process, not a brand fight. */
export const PLUG_NATURAL_RE =
  /\b(system|process|method|routine|tracker|app|tool|template|checklist|framework|how (do|can) (you|I) (keep|organize|plan|build))\b/i;

/** Help-lane ICP kill; presence-lane treats these as fashionFit candidates. */
export const HAUL_FLEX_RE =
  /\b(rate my|thrift haul|haul|fit check|just showing|look at (my|this)|flex)\b/i;

/** Fashion / outfit language for presence (includes haul/fit-check cues). */
export const FASHION_PRESENCE_RE =
  /\b(fit check|rate my|outfit|ootd|waywt|does (this|it) work|too (much|little|casual|dressy|tight|baggy)|thoughts on|how('s| is) (this|the)|style (this|me)|look(ing)? ok|pulling (it|this) off|silhouette|proportions|what do you think|honest (opinion|thoughts)|dress code|shoes with|pair(ed)? with)\b/i;

/** OP invites a short take (not pure silent flex). */
export const TAKE_INVITE_RE =
  /\b(rate|thoughts|honest|feedback|opinion|does (this|it)|too (much|little|casual|dressy)|ok\?|what do you think|how (does|do|'s|is)|any (tips?|ideas)|roast|be brutal)\b/i;

/**
 * Help-lane sweet-spot ceiling: comments at or below this earn competition.
 * Above = crowded (needs ICP or total ≥ {@link CROWDED_HELP_MIN_TOTAL}).
 */
export const HELP_COMPETITION_SWEET_MAX = 25;

/** Presence-lane sweet-spot ceiling (busier visibility threads). */
export const PRESENCE_COMPETITION_SWEET_MAX = 35;

/**
 * Below/equal this count is "cold" (still earns competition; room to contribute).
 * Used for rationale / future ranking — not a hard kill.
 */
export const COMPETITION_COLD_MAX = 2;

/**
 * Crowded help without ICP still enqueues only when total ≥ this
 * (competition dim is false, so other dims must carry).
 */
export const CROWDED_HELP_MIN_TOTAL = 6;

/**
 * @deprecated Alias of {@link HELP_COMPETITION_SWEET_MAX} (sweet-spot ceiling).
 * Prefer the named constant; kept for older tests/callers.
 */
export const COMPETITION_MAX_COMMENTS = HELP_COMPETITION_SWEET_MAX;

/**
 * @deprecated Alias of {@link PRESENCE_COMPETITION_SWEET_MAX}.
 */
export const PRESENCE_COMPETITION_MAX_COMMENTS = PRESENCE_COMPETITION_SWEET_MAX;

/** Comment-count band for scout competition. */
export type CompetitionBand = "unknown" | "cold" | "sweet" | "crowded";

/** Legacy default when caller does not pass maxAgeMs (48h). Scout prefers cfg.scout.maxAgeHours. */
export const DEFAULT_FRESH_MS = 48 * 60 * 60 * 1000;

/** True for Daily Questions / WAYWT / megathreads — skip as engage targets. */
export function isMegathread(title: string): boolean {
  return MEGATHREAD_RE.test(title);
}

/**
 * Heuristic opportunity score for live Reddit posts.
 * Gated by isActionable (≥ {@link ACTIONABLE_SCORE_MIN}/{@link SCORE_MAX}).
 */
export function scoreRedditPost(
  post: RedditListingPost,
  opts?: {
    /**
     * When true, do not auto-fail megathread titles (playbook help_only / allow).
     * Default false — megathreads are treated as non-opportunities.
     */
    scoreMegathread?: boolean;
    /** Max age for freshnessOk (ms). Default {@link DEFAULT_FRESH_MS}. */
    maxAgeMs?: number;
    /** Optional playbook (sweet-max override). */
    playbook?: SubredditPlaybook;
  }
): {
  score: OpportunityScore;
  rationale: string;
  competitionBand: CompetitionBand;
} {
  const text = `${post.title}\n${post.selftext}`;
  const policy = getSubredditPolicy(post.subreddit);
  const ageMs = Date.now() - post.createdUtc * 1000;
  const mega = isMegathread(post.title);
  const skipMega = mega && !opts?.scoreMegathread;
  const brandOnly = BRAND_ONLY_RE.test(text);
  const haulFlex = HAUL_FLEX_RE.test(text);
  const freshMs =
    typeof opts?.maxAgeMs === "number" && Number.isFinite(opts.maxAgeMs)
      ? Math.max(0, opts.maxAgeMs)
      : DEFAULT_FRESH_MS;
  const freshHours = Math.round(freshMs / (60 * 60 * 1000));

  // Megathreads match “questions” heuristics but are not one-shot help posts
  // unless the sub playbook opts into scoring them.
  const problemFit = !skipMega && HELP_RE.test(text);
  const wantsHelp =
    !skipMega &&
    (QUESTION_RE.test(text) ||
      HELP_RE.test(text) ||
      /\b(please|any ideas)\b/i.test(text));
  const rulesOk = policy?.rulesOk ?? false;
  const freshnessOk = ageMs >= 0 && ageMs <= freshMs;
  const valueWithoutApp =
    problemFit &&
    !brandOnly &&
    post.selftext.length + post.title.length > 40;

  // ICP is wardrobe/system/planning language — not every "how should I" help ask.
  const icpFit =
    !skipMega &&
    !haulFlex &&
    !brandOnly &&
    (ICP_RE.test(text) ||
      /\b(capsule|wardrobe|closet|cohesive|outfit plan)\b/i.test(text));
  // Prefer explicit system/tool language; else solid help on an allowlisted sub.
  const plugNaturalness =
    !skipMega &&
    !haulFlex &&
    !brandOnly &&
    rulesOk &&
    (PLUG_NATURAL_RE.test(text) || (problemFit && valueWithoutApp && wantsHelp));

  const sweetMax =
    opts?.playbook?.competitionSweetMax ?? HELP_COMPETITION_SWEET_MAX;
  const band = competitionBand(post.numComments, sweetMax);
  const competition = scoreCompetitionSweet({
    numComments: post.numComments,
    sweetMax,
    crowdedOk: icpFit,
  });

  const score: OpportunityScore = {
    problemFit,
    wantsHelp,
    rulesOk,
    freshnessOk,
    valueWithoutApp,
    competition,
    icpFit,
    plugNaturalness,
  };

  const bits: string[] = [];
  if (mega && opts?.scoreMegathread) bits.push("megathread (playbook allows)");
  else if (mega) bits.push("skipped megathread/daily");
  if (problemFit) bits.push("problem-fit language");
  if (wantsHelp) bits.push("asks for help");
  if (rulesOk) bits.push(`r/${post.subreddit} allowlisted`);
  else bits.push("sub not allowlisted / rules risky");
  if (freshnessOk) bits.push(`fresh (<${freshHours}h)`);
  else bits.push("stale");
  if (valueWithoutApp) bits.push("value without app");
  bits.push(`competition=${band}${competition ? "+" : "-"}`);
  if (icpFit) bits.push("ICP fit");
  else bits.push("weak ICP");
  if (plugNaturalness) bits.push("plug feels natural");
  else bits.push("plug unnatural");
  if (policy?.note) bits.push(policy.note);
  bits.push(`total ${scoreTotalLocal(score)}/${SCORE_MAX} (need ≥${ACTIONABLE_SCORE_MIN})`);

  return { score, rationale: bits.join("; "), competitionBand: band };
}

/**
 * Classify comment-count band for competition scoring.
 * Unknown → optimistic "unknown" (treated like reachable).
 */
export function competitionBand(
  numComments: number | null | undefined,
  sweetMax: number = HELP_COMPETITION_SWEET_MAX,
  coldMax: number = COMPETITION_COLD_MAX
): CompetitionBand {
  const n = numComments;
  if (n === undefined || n === null || !Number.isFinite(n)) return "unknown";
  if (n < 0) return "unknown";
  if (n > sweetMax) return "crowded";
  if (n <= coldMax) return "cold";
  return "sweet";
}

/**
 * Soft competition: true in cold/sweet/unknown, or crowded when `crowdedOk`.
 */
export function scoreCompetitionSweet(opts: {
  numComments?: number | null;
  sweetMax?: number;
  /** When crowded, still award competition (help: ICP; presence: takeRoom). */
  crowdedOk?: boolean;
}): boolean {
  const sweetMax = opts.sweetMax ?? HELP_COMPETITION_SWEET_MAX;
  const band = competitionBand(opts.numComments, sweetMax);
  if (band === "unknown" || band === "cold" || band === "sweet") return true;
  return Boolean(opts.crowdedOk);
}

/**
 * Legacy helper: true when count ≤ max (unknown → true).
 * Prefer {@link scoreCompetitionSweet} for lane scoring.
 */
export function scoreCompetition(
  post: RedditListingPost,
  maxComments: number = COMPETITION_MAX_COMMENTS
): boolean {
  const n = post.numComments;
  if (n === undefined || n === null || !Number.isFinite(n)) return true;
  return n >= 0 && n <= maxComments;
}

/**
 * Help enqueue gate: actionable total + crowded bar
 * (crowded without ICP needs total ≥ {@link CROWDED_HELP_MIN_TOTAL}).
 */
export function isHelpOpportunityActionable(
  score: OpportunityScore,
  competitionBand: CompetitionBand
): boolean {
  const total = scoreTotalLocal(score);
  if (total < ACTIONABLE_SCORE_MIN) return false;
  if (competitionBand === "crowded" && !score.icpFit && total < CROWDED_HELP_MIN_TOTAL) {
    return false;
  }
  return true;
}

/**
 * Presence-lane score — fit checks / fashion takes welcome.
 * Does **not** hard-kill on {@link HAUL_FLEX_RE} (help lane still does via ICP/plug).
 */
export function scorePresencePost(
  post: RedditListingPost,
  opts: {
    playbook: SubredditPlaybook;
    /** Max age for freshnessOk (ms). Default {@link DEFAULT_FRESH_MS}. */
    maxAgeMs?: number;
  }
): {
  score: PresenceScore;
  rationale: string;
  competitionBand: CompetitionBand;
} {
  const text = `${post.title}\n${post.selftext}`;
  const policy = getSubredditPolicy(post.subreddit);
  const ageMs = Date.now() - post.createdUtc * 1000;
  const mega = isMegathread(post.title);
  const brandWar = BRAND_WAR_RE.test(text);
  const pb = opts.playbook;
  const freshMs =
    typeof opts.maxAgeMs === "number" && Number.isFinite(opts.maxAgeMs)
      ? Math.max(0, opts.maxAgeMs)
      : DEFAULT_FRESH_MS;
  const freshHours = Math.round(freshMs / (60 * 60 * 1000));

  const fashionFit =
    FASHION_PRESENCE_RE.test(text) ||
    HAUL_FLEX_RE.test(text) ||
    /\b(outfit|ootd|fit check)\b/i.test(text);

  const invitesTake = QUESTION_RE.test(text) || TAKE_INVITE_RE.test(text);
  const hasVisualHook = hasOutfitVisualHook(post);
  const bodySubstance = post.selftext.trim().length >= 24;
  // Pure silent flex (no invite, no photo, thin body) → no take room.
  const takeRoom =
    fashionFit &&
    !brandWar &&
    (invitesTake ||
      hasVisualHook ||
      (bodySubstance && HAUL_FLEX_RE.test(text) === false));

  const sweetMax = pb.competitionSweetMax ?? PRESENCE_COMPETITION_SWEET_MAX;
  const band = competitionBand(post.numComments, sweetMax);
  const competition = scoreCompetitionSweet({
    numComments: post.numComments,
    sweetMax,
    crowdedOk: takeRoom,
  });
  const freshnessOk = ageMs >= 0 && ageMs <= freshMs;
  const allowlisted = policy?.rulesOk ?? false;
  const rulesOk = allowlisted && pb.presenceEnabled === true;
  // Megathreads only when playbook allows them *and* presence is on.
  const voiceFit =
    !mega ||
    (pb.presenceEnabled &&
      (pb.megathreadPolicy === "help_only" ||
        pb.megathreadPolicy === "allow"));

  const score: PresenceScore = {
    fashionFit,
    takeRoom,
    competition,
    freshnessOk,
    rulesOk,
    voiceFit,
  };

  const bits: string[] = ["lane=presence"];
  if (mega && voiceFit) bits.push("megathread (playbook allows)");
  else if (mega) bits.push("skipped megathread/daily");
  if (fashionFit) bits.push("fashion/fit language");
  else bits.push("weak fashion fit");
  if (takeRoom) bits.push("room for a take");
  else bits.push("no take room");
  if (rulesOk) bits.push(`r/${post.subreddit} presence on`);
  else if (!pb.presenceEnabled) bits.push("presence disabled on playbook");
  else bits.push("sub not allowlisted / rules risky");
  if (freshnessOk) bits.push(`fresh (<${freshHours}h)`);
  else bits.push("stale");
  bits.push(`competition=${band}${competition ? "+" : "-"}`);
  if (voiceFit) bits.push("voice fit");
  else bits.push("voice blocked");
  if (policy?.note) bits.push(policy.note);
  bits.push(
    `total ${presenceScoreTotalLocal(score)}/${PRESENCE_SCORE_MAX} (need ≥${PRESENCE_ACTIONABLE_MIN})`
  );

  return { score, rationale: bits.join("; "), competitionBand: band };
}

/** Image/gallery / non-self posts where a short outfit take is natural. */
export function hasOutfitVisualHook(post: RedditListingPost): boolean {
  if (post.isSelf === false) return true;
  const url = (post.url ?? "").toLowerCase();
  if (!url) return false;
  if (
    /i\.redd\.it|reddit\.com\/gallery|imgur\.com|\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(
      url
    )
  ) {
    return true;
  }
  const permalink = (post.permalink ?? "").replace(/\/+$/, "");
  const dest = url.replace(/\/+$/, "");
  return Boolean(
    permalink &&
      dest &&
      dest !== permalink.toLowerCase() &&
      !/\/comments\//i.test(url)
  );
}

function scoreTotalLocal(score: OpportunityScore): number {
  return (
    Number(score.problemFit) +
    Number(score.wantsHelp) +
    Number(score.rulesOk) +
    Number(score.freshnessOk) +
    Number(score.valueWithoutApp) +
    Number(score.competition) +
    Number(score.icpFit) +
    Number(score.plugNaturalness)
  );
}

function presenceScoreTotalLocal(score: PresenceScore): number {
  return (
    Number(score.fashionFit) +
    Number(score.takeRoom) +
    Number(score.competition) +
    Number(score.freshnessOk) +
    Number(score.rulesOk) +
    Number(score.voiceFit)
  );
}
