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

/** Max top-level-ish comment count still considered “room to contribute”. */
export const COMPETITION_MAX_COMMENTS = 12;

/** Presence threads often draw more comments; slightly looser than help. */
export const PRESENCE_COMPETITION_MAX_COMMENTS = 20;

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
  }
): {
  score: OpportunityScore;
  rationale: string;
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

  const competition = scoreCompetition(post);
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
  if (competition) bits.push("low competition");
  else bits.push("high competition");
  if (icpFit) bits.push("ICP fit");
  else bits.push("weak ICP");
  if (plugNaturalness) bits.push("plug feels natural");
  else bits.push("plug unnatural");
  if (policy?.note) bits.push(policy.note);
  bits.push(`total ${scoreTotalLocal(score)}/${SCORE_MAX} (need ≥${ACTIONABLE_SCORE_MIN})`);

  return { score, rationale: bits.join("; ") };
}

/**
 * True when the thread still has room for a helpful reply.
 * Unknown comment count (browser extract) → optimistic true.
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

  const competition = scoreCompetition(
    post,
    PRESENCE_COMPETITION_MAX_COMMENTS
  );
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
  if (competition) bits.push("low competition");
  else bits.push("high competition");
  if (voiceFit) bits.push("voice fit");
  else bits.push("voice blocked");
  if (policy?.note) bits.push(policy.note);
  bits.push(
    `total ${presenceScoreTotalLocal(score)}/${PRESENCE_SCORE_MAX} (need ≥${PRESENCE_ACTIONABLE_MIN})`
  );

  return { score, rationale: bits.join("; ") };
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
