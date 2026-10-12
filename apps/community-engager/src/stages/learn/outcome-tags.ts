/**
 * Write post-engagement VoltMem outcome tags (got_reply, removed, …).
 * Fact phrasing lives in CommunityMemory; this module owns event ids + heuristics.
 */

import type { ContextEngine } from "@relay/context-engine";
import {
  CommunityMemory,
  communityFactDomain,
  type OutcomeTag,
} from "../../memory.js";
import type { MemoryWriteEvidence } from "../../metrics/run-evidence.js";

export interface OutcomeTagMeta {
  draftId?: string;
  jobId?: string;
  subreddit: string;
  threadUrl?: string;
  threadTitle?: string;
  note?: string;
  intensity?: number;
}

export interface OutcomeTagHint {
  tag: OutcomeTag;
  meta: OutcomeTagMeta;
}

const DM_INTEREST_RE =
  /\b(dm|d\.?m\.?|message me|msg me|chat|inbox|private message|pm me|send me a (?:dm|message))\b/i;

/** Heuristic: reply text suggests they want to continue off-thread. */
export function detectDmInterest(
  replies: ReadonlyArray<{ body?: string }>
): boolean {
  return replies.some((r) => DM_INTEREST_RE.test(r.body ?? ""));
}

export function outcomeTagEventId(
  tag: OutcomeTag,
  meta: OutcomeTagMeta
): string {
  const key = meta.draftId ?? meta.jobId ?? meta.subreddit;
  return `outcome:${tag}:${key}`;
}

/**
 * Idempotent-ish VoltMem write for one outcome tag (fail-open).
 */
export async function writeOutcomeTag(
  memory: ContextEngine,
  tag: OutcomeTag,
  meta: OutcomeTagMeta,
  opts?: { source?: string }
): Promise<MemoryWriteEvidence> {
  const domain = communityFactDomain("outcome");
  const eventId = outcomeTagEventId(tag, meta);
  const fact = CommunityMemory.outcomeTag(tag, meta);
  if (!domain) {
    return { attempted: false };
  }
  try {
    const written = await memory.addEvent(
      eventId,
      [{ content: fact, domain }],
      { source: opts?.source ?? "relay:community-engager" }
    );
    const ok = written.length > 0;
    console.log(
      `[outcome-tag] ${ok ? "ok" : "skipped"} tag=${tag} event=${eventId}` +
        (written[0]?.action ? ` action=${written[0].action}` : "")
    );
    return {
      attempted: true,
      ok,
      domain,
      outcome: tag,
      eventId,
      action: written[0]?.action,
    };
  } catch (err) {
    console.warn(
      `[outcome-tag] write failed tag=${tag}:`,
      err instanceof Error ? err.message : err
    );
    return { attempted: true, ok: false, domain, outcome: tag, eventId };
  }
}

export async function writeOutcomeTagHints(
  memory: ContextEngine,
  hints: ReadonlyArray<OutcomeTagHint>,
  opts?: { source?: string }
): Promise<MemoryWriteEvidence[]> {
  const out: MemoryWriteEvidence[] = [];
  for (const h of hints) {
    out.push(await writeOutcomeTag(memory, h.tag, h.meta, opts));
  }
  return out;
}

/** Tokens for rememberForPrompt so outcome tags are retrieved into drafts. */
export const OUTCOME_REMEMBER_TOKENS =
  "got_reply removed dm_interest signup_attributed outcome intensity";

/**
 * After bumping `attribution/activations.json`, write one signup_attributed
 * fact per new activation (capped) so the drafter can learn what converted.
 */
export async function writeSignupAttributedForDelta(
  memory: ContextEngine,
  previous: number,
  next: number,
  opts?: { notes?: string; subreddit?: string; source?: string }
): Promise<MemoryWriteEvidence[]> {
  const delta = Math.max(0, next - previous);
  if (delta === 0) return [];
  const capped = Math.min(delta, 5);
  const out: MemoryWriteEvidence[] = [];
  for (let i = 0; i < capped; i++) {
    out.push(
      await writeOutcomeTag(
        memory,
        "signup_attributed",
        {
          draftId: `activation:${next - capped + i + 1}`,
          subreddit: opts?.subreddit ?? "reddit",
          note:
            opts?.notes ??
            `activations ${previous}→${next} (slot ${i + 1}/${capped})`,
        },
        { source: opts?.source }
      )
    );
  }
  return out;
}
