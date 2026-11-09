import type { AgentContext } from "@relay/runtime";
import type { CreateProposal } from "../../types.js";
import { remodelWinnersToProposal } from "./remodel.js";
import { createProposalToDraft } from "./proposal-to-draft.js";
import { scoutWinners, type WinnerScoutOptions } from "./winner-scout.js";

export interface RunCreateResult {
  proposals: CreateProposal[];
  status: "ok" | "empty" | "error";
  message: string;
}

/**
 * Create-lane: winner scout → pattern extract + remodel → one proposal as opportunity.
 */
export async function runCreatePipeline(
  ctx: AgentContext,
  opts: WinnerScoutOptions = {}
): Promise<RunCreateResult> {
  ctx.engageKind = "create";

  let winners;
  try {
    winners = await scoutWinners({ ...opts, limit: opts.limit ?? 2 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[create] winner scout failed:", message);
    ctx.opportunities = [];
    return { proposals: [], status: "error", message };
  }

  if (winners.length === 0) {
    ctx.opportunities = [];
    return {
      proposals: [],
      status: "empty",
      message: "No winner sources (allowsOriginalPosts / cooldown / filters).",
    };
  }

  const remodeled = await remodelWinnersToProposal(winners, {
    nowMs: opts.nowMs,
  });
  if (!remodeled) {
    ctx.opportunities = [];
    return {
      proposals: [],
      status: "empty",
      message: "Remodel produced no proposal.",
    };
  }

  const proposal = remodeled.proposal;
  const draft = createProposalToDraft(proposal);
  ctx.opportunities = [draft];
  ctx.createProposal = proposal;

  console.log(
    `[create] proposal r/${proposal.subreddit} «${proposal.title.slice(0, 60)}» ` +
      `via ${remodeled.provider}/${remodeled.model} · sources=${proposal.sourcePermalinks.length}`
  );

  return {
    proposals: [proposal],
    status: "ok",
    message: `Proposed original post for r/${proposal.subreddit}`,
  };
}
