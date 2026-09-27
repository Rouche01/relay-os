/**
 * CommunityEngager-owned memory fact phrasing.
 * Keep this out of @relay/context-engine so other apps stay uncoupled.
 */

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

  voiceConstraint(note: string): string {
    return `Voice constraint: ${note}`;
  },
};
