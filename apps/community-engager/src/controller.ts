import {
  createActionRecord,
  type ActionStore,
} from "@relay/action-store";
import type { ContextEngine } from "@relay/context-engine";
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
import { CommunityMemory } from "./memory.js";
import { loginRedditBrowser } from "./reddit/browser-login.js";
import { getRedditEnv, type RedditEnvConfig } from "./reddit/config.js";
import {
  isLoginCredentialPoint,
  isOtpCredentialPoint,
  parseCredentialValue,
} from "./reddit/credentials.js";
import { hasStorageState } from "./reddit/cookies.js";
import { scoutOpportunities } from "./scout.js";
import type { CommunityDraft } from "./types.js";
import { isActionable, scoreTotal } from "./types.js";

const APP_ID = "community-engager";

export interface CommunityControllerOptions {
  store: ActionStore;
  memory: ContextEngine;
  getContext: () => AgentContext;
  /**
   * Single opportunity this controller is responsible for (job runtimes).
   * Omit for the run-level runtime, which scouts the queue instead.
   */
  opportunity?: CommunityDraft;
}

type EnsureSessionResult = {
  ok: boolean;
  source?: "jar" | "env" | "hitl" | "deferred";
  storagePath?: string;
  error?: string;
  challenged?: boolean;
};

/**
 * Stage logic: ensure_session → scout → draft → HITL → execute → learn.
 */
export class CommunityEngagerController implements AppController {
  constructor(private readonly options: CommunityControllerOptions) {}

  async onStageStart(stage: StageDefinition, engine?: ExecutionEngine): Promise<void> {
    const ctx = this.options.getContext();

    switch (stage.name) {
      case "ensure_session":
        await this.runEnsureSessionStart(ctx);
        break;
      case "scout":
        await this.runScout(ctx);
        break;
      case "draft":
        await this.runDraft(ctx, engine);
        break;
      case "await_approval":
        break;
      case "jobs":
        // Fanout handled by AgentRuntime; nothing for the parent controller.
        break;
      case "execute":
        await this.runExecute(ctx);
        break;
      case "learn":
        await this.runLearn(ctx, engine);
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
    if (stage.name === "ensure_session") {
      await this.applyEnsureSessionFeedback(feedback);
      return;
    }

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
      // Abort skips the learn stage — write memory here.
      await this.writeHitlMemory(draft, "aborted");
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
    fp: FeedbackPoint,
    context: AgentContext
  ): Promise<FeedbackContext | undefined> {
    if (stage.name === "ensure_session") {
      return {
        title: "Reddit session",
        url: "https://www.reddit.com/login/",
        details: [
          { label: "Stage", value: "ensure_session" },
          {
            label: "Hint",
            value: isOtpCredentialPoint(fp.description)
              ? "Paste the one-time code only"
              : "Line 1: username · Line 2: password",
          },
        ],
        meta: { kind: isOtpCredentialPoint(fp.description) ? "otp" : "login" },
      };
    }
    if (stage.name !== "await_approval") return undefined;
    const draft = context.currentDraft as CommunityDraft | undefined;
    if (!draft) return undefined;
    return draftToFeedbackContext(draft);
  }

  async shouldSkipFeedbackPoint(
    stage: StageDefinition,
    fp: FeedbackPoint,
    context: AgentContext
  ): Promise<boolean> {
    if (stage.name === "ensure_session") {
      return this.shouldSkipEnsureSessionFeedback(fp, context);
    }
    if (stage.name !== "await_approval" || fp.type !== "confirmation") {
      return false;
    }
    const draft = context.currentDraft as CommunityDraft | undefined;
    // Intensity 2 only — skip confirmation for 0–1.
    return !draft || draft.intensity < 2;
  }

  async buildFeedbackPrompt(
    stage: StageDefinition,
    fp: FeedbackPoint,
    context: AgentContext
  ): Promise<string | undefined> {
    if (stage.name === "ensure_session") {
      if (isOtpCredentialPoint(fp.description)) {
        return (
          "Reddit asked for a verification code. Reply with the OTP only " +
          "(or abort to cancel)."
        );
      }
      return (
        "Reddit browser session needed (no cookie jar). " +
        "Reply with username on the first line and password on the second. " +
        "Abort to cancel. Do not use Approve — send the credentials as text."
      );
    }
    if (stage.name !== "await_approval") return undefined;
    const draft = context.currentDraft as CommunityDraft | undefined;
    if (!draft) return undefined;
    if (fp.type === "confirmation") {
      return (
        `Intensity ${draft.intensity}: confirm GoStylens disclosure + UTM link are intentional before post. ` +
        `Approve to confirm, or abort.`
      );
    }
    if (fp.type === "approval" && draft.intensity === 2) {
      return (
        `${fp.description}\n\n⚠️ Intensity 2 draft — a second confirmation step will follow.`
      );
    }
    return undefined;
  }

  private async runEnsureSessionStart(ctx: AgentContext): Promise<void> {
    const cfg = getRedditEnv();
    const force =
      process.env.REDDIT_ENSURE_SESSION === "true" ||
      process.env.REDDIT_ENSURE_SESSION === "1";

    if (await hasStorageState(cfg)) {
      const result: EnsureSessionResult = { ok: true, source: "jar" };
      this.setEnsureSession(ctx, result);
      console.log("[ensure_session] cookie jar present — skip login");
      return;
    }

    if (cfg.hasUserPass) {
      console.log("[ensure_session] env credentials — logging in…");
      const login = await loginRedditBrowser({ cfg, clearJar: true });
      if (!login.ok) {
        throw new Error(login.error ?? "ensure_session env login failed");
      }
      this.setEnsureSession(ctx, {
        ok: true,
        source: "env",
        storagePath: login.storagePath,
        challenged: login.challenged,
      });
      return;
    }

    if (!force && !this.sessionRequiredForRun(cfg)) {
      this.setEnsureSession(ctx, { ok: true, source: "deferred" });
      console.log(
        "[ensure_session] deferred (dry-run / non-browser write) — no HITL login"
      );
      return;
    }

    // HITL credential feedback will run next.
    console.log("[ensure_session] waiting for HITL credentials…");
  }

  private async shouldSkipEnsureSessionFeedback(
    fp: FeedbackPoint,
    context: AgentContext
  ): Promise<boolean> {
    if (fp.type !== "credential") return true;

    const prior = context.stageResults?.ensure_session as
      | EnsureSessionResult
      | undefined;

    if (isOtpCredentialPoint(fp.description)) {
      // v1: 2FA/CAPTCHA via headed browser + login onChallenge; dedicated OTP ask later
      return true;
    }

    if (isLoginCredentialPoint(fp.description)) {
      if (prior?.ok && (prior.source === "jar" || prior.source === "env" || prior.source === "hitl")) {
        return true;
      }
      if (prior?.source === "deferred") return true;
      return false;
    }

    return true;
  }

  private async applyEnsureSessionFeedback(
    feedback: FeedbackResponse
  ): Promise<void> {
    const ctx = this.options.getContext();

    if (isAbortResponse(feedback)) {
      this.setEnsureSession(ctx, {
        ok: false,
        error: "aborted",
      });
      return;
    }

    const creds = parseCredentialValue(feedback.value);
    if (!creds) {
      throw new Error(
        "ensure_session: expected credential value as username\\npassword (or { username, password })"
      );
    }

    // Never log password / full credential payload.
    console.log(`[ensure_session] HITL login as u/${creds.username}…`);

    const cfg = getRedditEnv();
    const login = await loginRedditBrowser({
      cfg,
      username: creds.username,
      password: creds.password,
      clearJar: true,
    });

    if (!login.ok) {
      throw new Error(login.error ?? "ensure_session HITL login failed");
    }

    this.setEnsureSession(ctx, {
      ok: true,
      source: "hitl",
      storagePath: login.storagePath,
      challenged: login.challenged,
    });
  }

  /**
   * Live browser write needs a jar. Dry-run and oauth-only writes do not.
   * Force with REDDIT_ENSURE_SESSION=true to prep a jar via HITL even when dry-run.
   */
  private sessionRequiredForRun(cfg: RedditEnvConfig): boolean {
    if (cfg.dryRun) return false;
    if (cfg.transport === "oauth" && cfg.oauthConfigured) return false;
    if (cfg.transport === "fixtures" || cfg.transport === "json") return false;
    return cfg.transport === "browser" || cfg.transport === "auto";
  }

  private setEnsureSession(ctx: AgentContext, result: EnsureSessionResult): void {
    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      ensure_session: result,
    };
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

  private async runDraft(
    ctx: AgentContext,
    engine?: ExecutionEngine
  ): Promise<void> {
    const top =
      this.options.opportunity ??
      (ctx.opportunity as CommunityDraft | undefined) ??
      this.pickFromQueue(ctx);

    const memoryBlock = await this.options.memory.rememberForPrompt(
      `community reddit draft r/${top.subreddit} ${top.threadTitle} intensity feedback abort approve`,
      { limit: 5 }
    );
    if (memoryBlock) {
      console.log(`[draft] injected agent memory (${memoryBlock.split("\n").length} lines)`);
    } else {
      console.log(`[draft] no agent memory (engine=${this.options.memory.name})`);
    }
    ctx.agentMemory = memoryBlock;

    let drafted: CommunityDraft;
    if (engine?.type === "llm") {
      const result = await engine.execute({
        type: "draft_reply",
        params: {
          draft: top,
          overrides: { memoryBlock: memoryBlock || undefined },
        },
      });
      if (!result.success || !result.data?.draft) {
        throw new Error(result.error ?? "llm draft_reply failed");
      }
      drafted = result.data.draft as CommunityDraft;
    } else {
      drafted = await draftReply(top, {
        memoryBlock: memoryBlock || undefined,
      });
    }

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
      draft: { id: drafted.id, memoryUsed: Boolean(memoryBlock) },
    };
    console.log(`[draft] pending_approval id=${drafted.id} intensity=${drafted.intensity}`);
  }

  /** Fallback for a single-runtime run (no job queue): take the top opportunity. */
  private pickFromQueue(ctx: AgentContext): CommunityDraft {
    const opportunities = (ctx.opportunities as CommunityDraft[] | undefined) ?? [];
    const top = opportunities.find((d) => isActionable(d.score));
    if (!top) {
      throw new Error("No actionable opportunity to draft — scout returned none");
    }
    return top;
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

  private async runLearn(
    ctx: AgentContext,
    engine?: ExecutionEngine
  ): Promise<void> {
    const draft = ctx.currentDraft as CommunityDraft | undefined;
    const outcome = String(ctx.hitlOutcome ?? draft?.status ?? "unknown");
    console.log(`[learn] outcome=${outcome} draft=${draft?.id ?? "n/a"}`);

    if (draft && (outcome === "approved" || outcome === "edited")) {
      await this.writeHitlMemory(draft, outcome, engine);
    }

    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      learn: {
        outcome,
        draftId: draft?.id,
        memoryAvailable: this.options.memory.available,
      },
    };
  }

  private async writeHitlMemory(
    draft: CommunityDraft,
    outcome: "aborted" | "approved" | "edited",
    engine?: ExecutionEngine
  ): Promise<void> {
    const fact =
      outcome === "aborted"
        ? CommunityMemory.aborted("user aborted before post", {
            subreddit: draft.subreddit,
            intensity: draft.intensity,
          })
        : CommunityMemory.approved({
            intensity: draft.intensity,
            subreddit: draft.subreddit,
            note: outcome === "edited" ? "human edited draft before approve" : undefined,
          });

    let ok: boolean;
    if (engine?.type === "data") {
      const result = await engine.execute({
        type: "add_fact",
        params: {
          text: fact,
          domain: "outcome",
          source: `relay:${APP_ID}`,
        },
      });
      ok = result.success;
    } else {
      ok = await this.options.memory.addFact(fact, {
        domain: "outcome",
        source: `relay:${APP_ID}`,
      });
    }
    console.log(
      `[learn] voltmem write ${ok ? "ok" : "skipped/fail-open"} (${outcome})`
    );
  }
}
