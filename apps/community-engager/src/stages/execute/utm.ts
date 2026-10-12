/**
 * UTM builder for CommunityEngager → GoStylens LP links.
 *
 * Layers:
 * - utm_source   = reddit                 (platform)
 * - utm_medium   = community-engager      (this app — stable product filter)
 * - utm_campaign = community_<subreddit>  (community + sub slice; matches draft label)
 * - utm_content  = <jobId>                (per-post join key)
 * - utm_term     = <subreddit>            (optional bare sub for tools that use term)
 */

export const UTM_APP_ID = "community-engager";

export interface UtmParams {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term?: string;
}

/** Sanitize tokens for query values (no spaces / colons). */
export function sanitizeUtmToken(raw: string): string {
  return raw
    .trim()
    .replace(/^r\//i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 120);
}

/** `community_<subreddit>` — same shape as scout draft `utmCampaign`. */
export function communityCampaign(subreddit?: string): string {
  const sub = subreddit ? sanitizeUtmToken(subreddit) : "";
  return sub ? `community_${sub}` : "community";
}

export function buildJobUtm(input: {
  jobId: string;
  subreddit?: string;
}): UtmParams {
  const content = sanitizeUtmToken(input.jobId) || "unknown";
  const term = input.subreddit
    ? sanitizeUtmToken(input.subreddit)
    : undefined;
  return {
    source: "reddit",
    medium: UTM_APP_ID,
    campaign: communityCampaign(input.subreddit),
    content,
    ...(term ? { term } : {}),
  };
}

/** Query string without leading `?`. */
export function utmQueryString(params: UtmParams): string {
  const parts = [
    `utm_source=${encodeURIComponent(params.source)}`,
    `utm_medium=${encodeURIComponent(params.medium)}`,
    `utm_campaign=${encodeURIComponent(params.campaign)}`,
    `utm_content=${encodeURIComponent(params.content)}`,
  ];
  if (params.term) {
    parts.push(`utm_term=${encodeURIComponent(params.term)}`);
  }
  return parts.join("&");
}

export function formatUtmLog(params: UtmParams): string {
  return (
    `[utm] medium=${params.medium} campaign=${params.campaign} content=${params.content}` +
    (params.term ? ` term=${params.term}` : "")
  );
}

/**
 * Resolve UTM for execute: always prefer jobId-backed params.
 */
export function resolveExecuteUtm(input: {
  jobId: string;
  subreddit?: string;
}): UtmParams {
  return buildJobUtm(input);
}
