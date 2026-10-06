/**
 * CommunityEngager-owned memory fact phrasing.
 * Keep this out of @relay/context-engine so other apps stay uncoupled.
 *
 * Short tags (`preference`, `outcome`, `rules`) map onto the kinds in
 * `voltmem-domains.json`. That file is what the sidecar loads via
 * `VOLTMEM_DOMAINS_FILE`.
 */

const COMMUNITY_FACT_DOMAINS: Record<string, string> = {
  preference: "community_preference",
  outcome: "community_outcome",
  rules: "community_rules",
};

/** Map an app tag onto the domain name registered in voltmem-domains.json. */
export function communityFactDomain(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  return COMMUNITY_FACT_DOMAINS[tag] ?? tag;
}

export const CommunityMemory = {
  aborted(reason: string, meta?: { subreddit?: string; intensity?: number }): string {
    const bits = [`Human aborted community draft: ${reason}`];
    if (meta?.subreddit) bits.push(`subreddit=r/${meta.subreddit}`);
    if (meta?.intensity !== undefined) bits.push(`intensity=${meta.intensity}`);
    return bits.join("; ");
  },

  approved(meta: {
    intensity: number;
    subreddit?: string;
    note?: string;
  }): string {
    const bits = [`Human approved community draft at intensity=${meta.intensity}`];
    if (meta.subreddit) bits.push(`subreddit=r/${meta.subreddit}`);
    if (meta.note) bits.push(meta.note);
    return bits.join("; ");
  },

  subredditRules(subreddit: string, note: string): string {
    return `Subreddit rules note for r/${subreddit}: ${note}`;
  },

  discoveryProposed(subreddit: string, note: string, evidence?: string): string {
    const bits = [
      `Discovery proposed subreddit r/${subreddit} (not postable until human promotes)`,
      note,
    ];
    if (evidence) bits.push(`evidence=${evidence}`);
    return bits.join("; ");
  },

  allowlistPromoted(subreddit: string, note?: string): string {
    const bits = [
      `Human promoted r/${subreddit} onto the community allowlist (postable)`,
    ];
    if (note) bits.push(note);
    return bits.join("; ");
  },

  voiceConstraint(note: string): string {
    return `Voice constraint: ${note}`;
  },
};
