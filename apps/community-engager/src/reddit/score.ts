import type { OpportunityScore } from "../types.js";
import { getSubredditPolicy } from "./config.js";
import type { RedditListingPost } from "./client.js";

const HELP_RE =
  /\b(how (do|can|should)|advice|help|tips?|suggest|recommend|looking for|struggle|can't figure|build a|capsule|system|wardrobe)\b/i;
const QUESTION_RE = /\?/;
const BRAND_ONLY_RE = /\b(what brand|best brand|buy this|haul)\b/i;
const FRESH_MS = 48 * 60 * 60 * 1000;

/**
 * Heuristic opportunity score for live Reddit posts.
 * Still gated by isActionable (≥ 4/5) before enqueue.
 */
export function scoreRedditPost(post: RedditListingPost): {
  score: OpportunityScore;
  rationale: string;
} {
  const text = `${post.title}\n${post.selftext}`;
  const policy = getSubredditPolicy(post.subreddit);
  const ageMs = Date.now() - post.createdUtc * 1000;

  const problemFit = HELP_RE.test(text);
  const wantsHelp =
    QUESTION_RE.test(text) || HELP_RE.test(text) || /\b(please|any ideas)\b/i.test(text);
  const rulesOk = policy?.rulesOk ?? false;
  const freshnessOk = ageMs >= 0 && ageMs <= FRESH_MS;
  const valueWithoutApp =
    problemFit && !BRAND_ONLY_RE.test(text) && post.selftext.length + post.title.length > 40;

  const score: OpportunityScore = {
    problemFit,
    wantsHelp,
    rulesOk,
    freshnessOk,
    valueWithoutApp,
  };

  const bits: string[] = [];
  if (problemFit) bits.push("problem-fit language");
  if (wantsHelp) bits.push("asks for help");
  if (rulesOk) bits.push(`r/${post.subreddit} allowlisted`);
  else bits.push("sub not allowlisted / rules risky");
  if (freshnessOk) bits.push("fresh (<48h)");
  else bits.push("stale");
  if (valueWithoutApp) bits.push("value without app");
  if (policy?.note) bits.push(policy.note);

  return { score, rationale: bits.join("; ") };
}
