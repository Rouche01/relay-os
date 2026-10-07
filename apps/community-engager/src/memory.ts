/**
 * CommunityEngager-owned memory fact phrasing.
 * Keep this out of @relay/context-engine so other apps stay uncoupled.
 *
 * Short tags (`preference`, `outcome`, `rules`) map onto the kinds in
 * `voltmem-domains.json`. That file is what the sidecar loads via
 * `VOLTMEM_DOMAINS_FILE`.
 *
 * Phrasing rule: put discriminating tokens first (draft id, r/sub, URL) so
 * VoltMem `remember` does not false-confirm near-identical templates.
 */

const COMMUNITY_FACT_DOMAINS: Record<string, string> = {
  preference: "community_preference",
  outcome: "community_outcome",
  rules: "community_rules",
};

/** Generic discovery boilerplate — omit from facts (fuels false merges). */
const GENERIC_DISCOVER_NOTE =
  /^Topic\/activity look relevant for fashion\/styling advice\.?$/i;

/** Map an app tag onto the domain name registered in voltmem-domains.json. */
export function communityFactDomain(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  return COMMUNITY_FACT_DOMAINS[tag] ?? tag;
}

function trimNote(note: string | undefined): string | undefined {
  const t = note?.trim();
  if (!t) return undefined;
  if (GENERIC_DISCOVER_NOTE.test(t)) return undefined;
  return t;
}

function clipTitle(title: string | undefined, max = 80): string | undefined {
  const t = title?.trim();
  if (!t) return undefined;
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export const CommunityMemory = {
  aborted(
    reason: string,
    meta: {
      draftId: string;
      subreddit: string;
      intensity: number;
      threadUrl?: string;
      threadTitle?: string;
    }
  ): string {
    const bits = [
      `draft=${meta.draftId}`,
      `r/${meta.subreddit}`,
      `HITL aborted intensity=${meta.intensity}`,
      `reason=${reason}`,
    ];
    if (meta.threadUrl) bits.push(`url=${meta.threadUrl}`);
    const title = clipTitle(meta.threadTitle);
    if (title) bits.push(`title=${title}`);
    return bits.join("; ");
  },

  approved(meta: {
    draftId: string;
    intensity: number;
    subreddit: string;
    threadUrl?: string;
    threadTitle?: string;
    note?: string;
  }): string {
    const bits = [
      `draft=${meta.draftId}`,
      `r/${meta.subreddit}`,
      `HITL approved intensity=${meta.intensity}`,
    ];
    if (meta.threadUrl) bits.push(`url=${meta.threadUrl}`);
    const title = clipTitle(meta.threadTitle);
    if (title) bits.push(`title=${title}`);
    const note = trimNote(meta.note);
    if (note) bits.push(note);
    return bits.join("; ");
  },

  subredditRules(subreddit: string, note?: string): string {
    const bits = [`r/${subreddit}`, "subreddit rules note"];
    const n = trimNote(note);
    if (n) bits.push(n);
    return bits.join("; ");
  },

  discoveryProposed(subreddit: string, note?: string, evidence?: string): string {
    const bits = [
      `r/${subreddit}`,
      "discovery proposed (not postable until human promotes)",
    ];
    const n = trimNote(note);
    if (n) bits.push(n);
    if (evidence?.trim()) bits.push(`evidence=${evidence.trim()}`);
    return bits.join("; ");
  },

  allowlistPromoted(subreddit: string, note?: string): string {
    const bits = [
      `r/${subreddit}`,
      "human promoted onto community allowlist (postable)",
    ];
    const n = trimNote(note);
    if (n) bits.push(n);
    return bits.join("; ");
  },

  voiceConstraint(note: string): string {
    return `Voice constraint: ${note}`;
  },
};
