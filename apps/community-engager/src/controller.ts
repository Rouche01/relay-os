import {
  createActionRecord,
  type ActionStore,
} from "@relay/action-store";
import {
  isAbortResponse,
  isEditResponse,
  type AgentContext,
  type ExecutionEngine,
  type FeedbackContext,
  type FeedbackPoint,
  type FeedbackResponse,
  type StageDefinition,
} from "@relay/protocol";
import type { AppController } from "@relay/runtime";
import { draftToFeedbackContext } from "./feedback-map.js";
import { draftReply } from "./drafter.js";
import { executeApproved } from "./executor.js";
import { scoutOpportunities } from "./scout.js";
import type { CommunityDraft } from "./types.js";
import { isActionable, scoreTotal } from "./types.js";

const APP_ID = "community-engager";

export interface CommunityControllerOptions {
  store: ActionStore;
  getContext: () => AgentContext;
}

/**
 * Stage logic for CommunityEngager: scout → draft → HITL → dry-run execute → learn stub.
 */
export class CommunityEngagerController implements AppController {
  constructor(private readonly options: CommunityControllerOptions) {}

  async onStageStart(stage: StageDefinition, _engine?: ExecutionEngine): Promise<void> {
    const ctx = this.options.getContext();

    switch (stage.name) {
      case "scout":
        await this.runScout(ctx);
        break;
      case "draft":
        await this.runDraft(ctx);
        break;
      case "await_approval":
        break;
      case "execute":
        await this.runExecute(ctx);
        break;
      case "learn":
        await this.runLearn(ctx);
        break;
      default:
        console.warn(`[community] unknown stage: ${stage.name}`);
    }
  }

  async onFeedbackApplied(
    stage: StageDefinition,
    feedback: FeedbackResponse,
    _engine?: ExecutionEngine
  ): Promise<void> {
    if (stage.name !== "await_approval") return;

    const ctx = this.options.getContext();
    const draft = ctx.currentDraft as CommunityDraft | undefined;
    if (!draft) {
      throw new Error("No currentDraft to apply feedback to");
    }

    if (isAbortResponse(feedback)) {
      draft.status = "aborted";
      await this.options.store.updateStatus(draft.id, "aborted", {
        payload: { status: "aborted" },
      });
      ctx.currentDraft = draft;
      ctx.hitlOutcome = "aborted";
      return;
    }

    if (isEditResponse(feedback)) {
      draft.draftText = String(feedback.value);
      draft.status = "edited";
      await this.options.store.updateStatus(draft.id, "edited", {
        payload: { draftText: draft.draftText, status: "edited" },
      });
      ctx.currentDraft = draft;
      ctx.feedbackContext = draftToFeedbackContext(draft);
      ctx.hitlOutcome = "edited";
      return;
    }

    draft.status = "approved";
    await this.options.store.updateStatus(draft.id, "approved", {
      payload: { status: "approved" },
    });
    ctx.currentDraft = draft;
    ctx.hitlOutcome = "approved";
  }

  async buildFeedbackContext(
    stage: StageDefinition,
    _fp: FeedbackPoint,
    context: AgentContext
  ): Promise<FeedbackContext | undefined> {
    if (stage.name !== "await_approval") return undefined;
    const draft = context.currentDraft as CommunityDraft | undefined;
    if (!draft) return undefined;
    return draftToFeedbackContext(draft);
  }

  private async runScout(ctx: AgentContext): Promise<void> {
    const opportunities = await scoutOpportunities({ limit: 5 });
    console.log(`[scout] ${opportunities.length} actionable (score ≥ 4)`);
    for (const d of opportunities) {
      console.log(
        `  - [${scoreTotal(d.score)}/5] r/${d.subreddit} · ${d.threadTitle}`
      );
    }
    ctx.opportunities = opportunities;
    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      scout: { count: opportunities.length, ids: opportunities.map((d) => d.id) },
    };
  }

  private async runDraft(ctx: AgentContext): Promise<void> {
    const opportunities = (ctx.opportunities as CommunityDraft[] | undefined) ?? [];
    const top = opportunities.find((d) => isActionable(d.score));
    if (!top) {
      throw new Error("No actionable opportunity to draft — scout returned none");
    }

    const drafted = await draftReply(top);
    await this.options.store.put(
      createActionRecord({
        id: drafted.id,
        appId: APP_ID,
        status: "pending_approval",
        payload: drafted,
      })
    );

    ctx.currentDraft = drafted;
    ctx.feedbackContext = draftToFeedbackContext(drafted);
    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      draft: { id: drafted.id },
    };
    console.log(`[draft] pending_approval id=${drafted.id} intensity=${drafted.intensity}`);
  }

  private async runExecute(ctx: AgentContext): Promise<void> {
    const draft = ctx.currentDraft as CommunityDraft | undefined;
    if (!draft) {
      throw new Error("No currentDraft for execute");
    }

    const result = await executeApproved(draft);
    ctx.executeResult = result;

    if (result.ok) {
      draft.status = "posted";
      try {
        await this.options.store.updateStatus(draft.id, "posted", {
          payload: { status: "posted" },
        });
      } catch (err) {
        console.warn("[execute] store status update:", err);
      }
      ctx.currentDraft = draft;
    } else {
      await this.options.store.updateStatus(draft.id, "failed", {
        payload: { status: "failed" },
      });
      throw new Error(result.error ?? "execute failed");
    }
  }

  private async runLearn(ctx: AgentContext): Promise<void> {
    const draft = ctx.currentDraft as CommunityDraft | undefined;
    const outcome = ctx.hitlOutcome ?? draft?.status ?? "unknown";
    console.log(
      `[learn] stub — outcome=${outcome} draft=${draft?.id ?? "n/a"} (VoltMem later)`
    );
    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      learn: { outcome, draftId: draft?.id },
    };
  }
}
