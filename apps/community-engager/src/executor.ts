import { isExecutableStatus } from "@relay/action-store";
import type { CommunityDraft } from "./types.js";

export interface ExecuteResult {
  ok: boolean;
  dryRun: boolean;
  postedUrl?: string;
  error?: string;
  log?: string;
}

/**
 * Posts only after human approval.
 * v1: dry-run log — no Reddit write until Phase 2.
 */
export async function executeApproved(draft: CommunityDraft): Promise<ExecuteResult> {
  if (!isExecutableStatus(draft.status)) {
    return {
      ok: false,
      dryRun: true,
      error: `refusing to post status=${draft.status}`,
    };
  }

  const log =
    `[dry-run] Would post to r/${draft.subreddit}\n` +
    `  thread: ${draft.threadUrl}\n` +
    `  intensity: ${draft.intensity}\n` +
    `  text:\n${draft.draftText}`;

  console.log(log);

  return {
    ok: true,
    dryRun: true,
    log,
    postedUrl: undefined,
  };
}
