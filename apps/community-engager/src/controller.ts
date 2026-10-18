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
import type { FeedbackAdapter } from "@relay/feedback-broker";
import { draftToFeedbackContext } from "./decide/feedback-map.js";
import { applyWarmupClamp, draftReply } from "./stages/draft/drafter.js";
import {
  formatPromoRatioLog,
  readPromoLedger,
  recordPromoLedgerPost,
  resolvePromoRatioStatus,
  type PromoRatioStatus,
} from "./policy/promo-ratio.js";
import {
  formatWarmupLog,
  recordHelpCommentPosted,
  resolveWarmupStatus,
  type WarmupStatus,
} from "./policy/warmup.js";
import {
  countPlugsThisWeek,
  formatPlaybookSummary,
  shouldBlockPlugForWeek,
} from "./policy/playbook.js";
import {
  enrollPostWatch,
  formatPostWatchLog,
  processDuePostWatches,
} from "./stages/post-watch/post-watch.js";
import {
  cadenceBlocksIntensity,
  formatCadenceLog,
  resolveCadenceStatus,
  trimOpportunitiesForCadence,
  type CadenceStatus,
} from "./policy/cadence.js";
import {
  checkCommentVisibility,
  formatVisibilityLog,
  type VisibilityCheckResult,
} from "./stages/execute/visibility.js";
import {
  OUTCOME_REMEMBER_TOKENS,
  writeOutcomeTag,
  writeOutcomeTagHints,
} from "./stages/learn/outcome-tags.js";
import {
  DISCOVER_SKIP_OPTION,
  discoveryChoiceOptions,
  parseDiscoveryChoices,
  runDiscovery,
} from "./stages/discover/discover.js";
import { shouldTriggerEmptyScoutFallback } from "./stages/discover/empty-scout-fallback.js";
import {
  incrementEmptyScoutFallbackDailyCount,
  readEmptyScoutFallbackDailyCount,
} from "./stages/discover/empty-scout-fallback-ledger.js";
import {
  executeApproved,
  type ExecuteResult,
} from "./stages/execute/executor.js";
import { formatManualPostNotify } from "./stages/execute/manual-notify.js";
import { executeJobId } from "./reddit/scout/scout-live.js";
import { getAllowlistStore, resolvePlaybook } from "./policy/allowlist-store.js";
import { CommunityMemory, communityFactDomain } from "./memory.js";
import {
  fillAndSubmitRedditLogin,
  loginRedditBrowser,
  openRedditLoginForm,
  waitUntilRedditLoggedIn,
} from "./reddit/session/browser-login.js";
import { createRedditBrowserEngine } from "./reddit/session/browser-session.js";
import { getCommunityConfig, type CommunityRuntimeConfig } from "./reddit/config.js";
import type { DiscoveryCandidate } from "./reddit/scout/discover-subs.js";
import {
  isLoginCredentialPoint,
  isOtpCredentialPoint,
  parseCredentialValue,
} from "./reddit/session/credentials.js";
import { hasStorageState, storageStatePath } from "./reddit/session/cookies.js";
import { detectInterstitial } from "./reddit/interstitial/interstitial.js";
import {
  clearInterstitialSession,
  getInterstitialSession,
  saveInterstitialCookies,
  setInterstitialSession,
} from "./reddit/interstitial/interstitial-session.js";
import { scoutOpportunities } from "./stages/scout/scout.js";
import type { CommunityDraft } from "./types.js";
import { ACTIONABLE_SCORE_MIN, isActionable, SCORE_MAX, scoreTotal } from "./types.js";
import {
  draftPreview,
  type DiscoverEvidence,
  type DraftEvidence,
  type DraftProvider,
  type ExecuteEvidence,
  type HitlEvidence,
  type MemoryWriteEvidence,
  type SessionEvidence,
} from "./metrics/run-evidence.js";

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
  /** HITL adapter — used for one-way CAPTCHA notices during login. */
  adapter?: FeedbackAdapter;
}

type EnsureSessionResult = {
  ok: boolean;
  source?: "jar" | "env" | "hitl" | "deferred";
  storagePath?: string;
  error?: string;
  challenged?: boolean;
};

/**
 * Stage logic (engage): ensure_session → discover → scout → jobs…
 * Stage logic (post_watch entrypoint): post_watch → jobs…
 * Job stages: draft → HITL → execute → learn.
 */
export class CommunityEngagerController implements AppController {
  constructor(private readonly options: CommunityControllerOptions) {}

  async onStageStart(stage: StageDefinition, engine?: ExecutionEngine): Promise<void> {
    const ctx = this.options.getContext();

    switch (stage.name) {
      case "ensure_session":
        await this.runEnsureSessionStart(ctx);
        break;
      case "discover":
        await this.runDiscover(ctx);
        break;
      case "scout":
        await this.runScout(ctx);
        break;
      case "post_watch":
        await this.runPostWatch(ctx);
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
  ): Promise<void | boolean> {
    if (stage.name === "ensure_session") {
      await this.applyEnsureSessionFeedback(feedback);
      return;
    }

    if (stage.name === "discover") {
      const challenge = this.options.getContext().discoverChallenge as
        | { reason?: string }
        | undefined;
      let result: void | boolean;
      if (challenge?.reason === "login_wall") {
        result = await this.applyDiscoverLoginFeedback(feedback);
      } else if (challenge) {
        result = await this.applyDiscoverCaptchaFeedback(feedback);
      } else {
        result = await this.applyDiscoverFeedback(feedback);
      }
      this.finishDiscoverHitlWait(feedback);
      return result;
    }

    if (stage.name === "scout") {
      const ctx = this.options.getContext();
      if (ctx.emptyScoutFallbackActive) {
        return this.applyEmptyScoutFallbackHitl(feedback);
      }
      const challenge = ctx.interstitialChallenge as
        | { reason?: string }
        | undefined;
      if (
        challenge?.reason === "login_wall" ||
        challenge?.reason === "login_pending"
      ) {
        const creds = parseCredentialValue(feedback.value);
        if (creds || isAbortResponse(feedback)) {
          const out = await this.applyLoginWallCredentialFeedback(feedback);
          this.finishScoutHitlWait();
          return out;
        }
      }
      const out = await this.applyInterstitialFeedback(feedback);
      this.finishScoutHitlWait();
      return out;
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
      this.recordJobHitl(ctx, "aborted");
      return;
    }

    if (isEditResponse(feedback)) {
      draft.draftText = String(feedback.value);
      draft.status = "edited";
      const warmup = ctx.warmupStatus as WarmupStatus | undefined;
      const promo = ctx.promoRatioStatus as PromoRatioStatus | undefined;
      const cadence = ctx.cadenceStatus as CadenceStatus | undefined;
      const forceIntensity0 = Boolean(
        warmup?.active || promo?.blockPromo || cadence?.promoExhausted
      );
      const clamped = applyWarmupClamp(draft, forceIntensity0, {
        title: draft.threadTitle,
        subreddit: draft.subreddit,
        opText: draft.opText,
        memoryHint: true,
      });
      Object.assign(draft, clamped);
      await this.options.store.updateStatus(draft.id, "edited", {
        payload: {
          draftText: draft.draftText,
          intensity: draft.intensity,
          status: "edited",
        },
      });
      ctx.currentDraft = draft;
      ctx.feedbackContext = draftToFeedbackContext(draft, {
        warmup,
        promo,
        cadence,
        postMode: getCommunityConfig().postMode,
      });
      ctx.hitlOutcome = "edited";
      this.recordJobHitl(ctx, "edited");
      return;
    }

    draft.status = "approved";
    await this.options.store.updateStatus(draft.id, "approved", {
      payload: { status: "approved" },
    });
    ctx.currentDraft = draft;
    ctx.hitlOutcome = "approved";
    this.recordJobHitl(ctx, "approved");
  }

  async buildFeedbackContext(
    stage: StageDefinition,
    fp: FeedbackPoint,
    context: AgentContext
  ): Promise<FeedbackContext | undefined> {
    // Any blocking feedback we build starts the HITL wait clock once.
    const markWait = () => this.markHitlWaitStart(context);

    if (stage.name === "ensure_session") {
      markWait();
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
    if (stage.name === "discover" && fp.type === "credential") {
      markWait();
      const challenge = context.discoverChallenge as
        | { url?: string; reason?: string }
        | undefined;
      return {
        title: "Reddit login required (discover)",
        url: challenge?.url ?? "https://www.reddit.com/login/",
        details: [
          { label: "Stage", value: "discover" },
          { label: "Reason", value: challenge?.reason ?? "login_wall" },
          {
            label: "Hint",
            value:
              "Login form is open in the headed browser. Reply with username then password — we fill and submit for you.",
          },
        ],
        meta: { kind: "login" },
      };
    }
    if (stage.name === "discover" && fp.type === "confirmation") {
      markWait();
      const challenge = context.discoverChallenge as
        | { url?: string; reason?: string }
        | undefined;
      return {
        title: "Discover blocked — solve CAPTCHA",
        url: challenge?.url,
        details: [
          { label: "Stage", value: "discover" },
          { label: "Reason", value: challenge?.reason ?? "captcha" },
          {
            label: "Hint",
            value:
              "Solve the CAPTCHA in the headed browser — we auto-continue when it clears (or Approve). Abort skips discovery and continues to scout.",
          },
        ],
        meta: { kind: "interstitial" },
      };
    }
    if (stage.name === "discover" && fp.type === "choice") {
      markWait();
      const candidates = (context.discoveryCandidates ?? []) as DiscoveryCandidate[];
      return {
        title: "Promote discovered subreddit(s)?",
        body: candidates
          .map(
            (c) =>
              `r/${c.name} · fit ${c.fitScore}/10 · ${c.subscribers} subs\n${c.note}`
          )
          .join("\n\n"),
        details: [
          { label: "Candidates", value: String(candidates.length) },
          {
            label: "Hint",
            value:
              "Reply with one or more (e.g. r/a, r/b), or none (skip). Abort also skips.",
          },
        ],
        meta: { kind: "discover" },
      };
    }
    if (stage.name === "scout" && (fp.type === "credential" || fp.type === "confirmation")) {
      markWait();
    }
    if (stage.name === "await_approval") {
      markWait();
    }
    if (stage.name === "scout" && fp.type === "credential") {
      const challenge = context.interstitialChallenge as
        | { url?: string; subreddit?: string; blockedSubs?: string[] }
        | undefined;
      return {
        title: "Reddit login required",
        url: challenge?.url ?? "https://www.reddit.com/login/",
        details: [
          { label: "Subreddit", value: challenge?.subreddit ?? "?" },
          {
            label: "Blocked",
            value: (challenge?.blockedSubs ?? []).map((s) => `r/${s}`).join(", "),
          },
          {
            label: "Hint",
            value:
              "Login form is open in the headed browser. Reply username (line 1) + password (line 2). We fill, submit, and save cookies.",
          },
        ],
        meta: { kind: "login" },
      };
    }
    if (stage.name === "scout" && fp.type === "confirmation") {
      const challenge = context.interstitialChallenge as
        | { url?: string; subreddit?: string; blockedSubs?: string[]; reason?: string }
        | undefined;
      return {
        title:
          challenge?.reason === "login_pending"
            ? "Finish Reddit login (2FA / CAPTCHA)"
            : "Reddit anti-bot challenge",
        url: challenge?.url,
        details: [
          { label: "Subreddit", value: challenge?.subreddit ?? "?" },
          {
            label: "Blocked",
            value: (challenge?.blockedSubs ?? []).map((s) => `r/${s}`).join(", "),
          },
          {
            label: "Hint",
            value:
              challenge?.reason === "login_pending"
                ? "Complete 2FA/CAPTCHA in the headed browser — we auto-continue when logged in (or Approve)."
                : "Solve the CAPTCHA in the open browser. We auto-continue when it clears (or Approve in Telegram). Abort skips.",
          },
        ],
        meta: {
          kind:
            challenge?.reason === "login_pending" ? "login" : "interstitial",
        },
      };
    }
    if (stage.name !== "await_approval") return undefined;
    const draft = context.currentDraft as CommunityDraft | undefined;
    if (!draft) return undefined;
    const warmup = context.warmupStatus as WarmupStatus | undefined;
    const promo = context.promoRatioStatus as PromoRatioStatus | undefined;
    const cadence = context.cadenceStatus as CadenceStatus | undefined;
    const postMode = getCommunityConfig().postMode;
    return draftToFeedbackContext(draft, { warmup, promo, cadence, postMode });
  }

  async shouldSkipFeedbackPoint(
    stage: StageDefinition,
    fp: FeedbackPoint,
    context: AgentContext
  ): Promise<boolean> {
    if (stage.name === "ensure_session") {
      return this.shouldSkipEnsureSessionFeedback(fp, context);
    }
    if (stage.name === "discover") {
      // Gated skip / failed research — no discover HITL.
      if (context.discoverRan === false) return true;
      if (fp.type === "credential") {
        const challenge = context.discoverChallenge as
          | { reason?: string }
          | undefined;
        return challenge?.reason !== "login_wall";
      }
      if (fp.type === "confirmation") {
        const challenge = context.discoverChallenge as
          | { reason?: string }
          | undefined;
        if (!challenge) return true;
        // Credential FP owns the pure login-wall case.
        return challenge.reason === "login_wall";
      }
      if (fp.type === "choice") {
        const candidates = (context.discoveryCandidates ??
          []) as DiscoveryCandidate[];
        return candidates.length === 0;
      }
    }
    if (stage.name === "scout" && fp.type === "credential") {
      if (context.emptyScoutFallbackActive) {
        const discoverChallenge = context.discoverChallenge as
          | { reason?: string }
          | undefined;
        return discoverChallenge?.reason !== "login_wall";
      }
      const challenge = context.interstitialChallenge as
        | { reason?: string }
        | undefined;
      return challenge?.reason !== "login_wall";
    }
    if (stage.name === "scout" && fp.type === "confirmation") {
      if (context.emptyScoutFallbackActive) {
        const discoverChallenge = context.discoverChallenge as
          | { reason?: string }
          | undefined;
        if (!discoverChallenge) return true;
        return discoverChallenge.reason === "login_wall";
      }
      const challenge = context.interstitialChallenge as
        | { reason?: string }
        | undefined;
      if (!challenge) return true;
      // Credential owns login_wall; confirmation covers CAPTCHA + post-login 2FA.
      if (challenge.reason === "login_wall") return true;
      return false;
    }
    if (stage.name === "scout" && fp.type === "choice") {
      if (!context.emptyScoutFallbackActive) return true;
      const candidates = (context.discoveryCandidates ??
        []) as DiscoveryCandidate[];
      return candidates.length === 0;
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
    if (stage.name === "discover" && fp.type === "credential") {
      return (
        `Discover needs a Reddit login (login wall). ` +
        `The headed browser has the login form open — reply with username on line 1 and password on line 2. ` +
        `We fill the form, submit, and save cookies. Abort skips discovery.`
      );
    }
    if (stage.name === "discover" && fp.type === "confirmation") {
      const challenge = context.discoverChallenge as
        | { reason?: string; url?: string }
        | undefined;
      return (
        `Discover hit a Reddit anti-bot wall (${challenge?.reason ?? "captcha"}). ` +
        `Use the headed browser — we auto-continue when the wall clears (or Approve). ` +
        `Abort skips discovery; scout continues on the existing allowlist.`
      );
    }
    if (stage.name === "discover" && fp.type === "choice") {
      const candidates = (context.discoveryCandidates ?? []) as DiscoveryCandidate[];
      return (
        `Found ${candidates.length} candidate subreddit(s). ` +
        `Promote one or more onto the allowlist (reply e.g. r/a, r/b), ` +
        `or choose "${DISCOVER_SKIP_OPTION}". Nothing is postable until you promote.`
      );
    }
    if (stage.name === "scout" && fp.type === "credential") {
      if (context.emptyScoutFallbackActive) {
        return (
          `Empty-scout fallback discover needs a Reddit login (login wall). ` +
          `The headed browser has the login form open — reply with username on line 1 and password on line 2. ` +
          `Abort skips fallback discovery.`
        );
      }
      const challenge = context.interstitialChallenge as
        | { subreddit?: string }
        | undefined;
      return (
        `Reddit login wall on r/${challenge?.subreddit ?? "?"}. ` +
        `Login form is open in the headed browser — reply with username then password. ` +
        `We fill, submit, and save the session. Abort skips.`
      );
    }
    if (stage.name === "scout" && fp.type === "confirmation") {
      if (context.emptyScoutFallbackActive) {
        const challenge = context.discoverChallenge as
          | { reason?: string }
          | undefined;
        return (
          `Empty-scout fallback discover hit a Reddit anti-bot wall (${challenge?.reason ?? "captcha"}). ` +
          `Use the headed browser — we auto-continue when the wall clears (or Approve). ` +
          `Abort skips fallback discovery.`
        );
      }
      const challenge = context.interstitialChallenge as
        | { subreddit?: string; url?: string; reason?: string }
        | undefined;
      if (challenge?.reason === "login_pending") {
        return (
          `Credentials submitted for r/${challenge?.subreddit ?? "?"}, but Reddit still needs a step ` +
          `(2FA / CAPTCHA). Finish it in the headed window — we auto-detect login (or Approve). Abort skips.`
        );
      }
      return (
        `Reddit challenged the browser (r/${challenge?.subreddit ?? "?"}). ` +
        `Solve the CAPTCHA in the headed window — we auto-detect when it clears and continue ` +
        `(or tap Approve). Abort skips. We never auto-solve CAPTCHAs.`
      );
    }
    if (
      stage.name === "scout" &&
      fp.type === "choice" &&
      context.emptyScoutFallbackActive
    ) {
      const candidates = (context.discoveryCandidates ?? []) as DiscoveryCandidate[];
      return (
        `Scout found nothing actionable; forced discover found ${candidates.length} candidate(s). ` +
        `Promote one or more onto the allowlist (reply e.g. r/a, r/b), ` +
        `or choose "${DISCOVER_SKIP_OPTION}". Then we re-scout once.`
      );
    }
    if (stage.name !== "await_approval") return undefined;
    const draft = context.currentDraft as CommunityDraft | undefined;
    if (!draft) return undefined;
    const postMode = getCommunityConfig().postMode;
    if (fp.type === "confirmation") {
      if (postMode === "manual") {
        return (
          `Intensity ${draft.intensity}: confirm GoStylens disclosure + UTM in the suggested text. ` +
          `Approve = you will post manually (no auto-comment). Abort cancels.`
        );
      }
      return (
        `Intensity ${draft.intensity}: confirm GoStylens disclosure + UTM link are intentional before post. ` +
        `Approve to confirm, or abort.`
      );
    }
    if (fp.type === "approval" && postMode === "manual") {
      const intensityNote =
        draft.intensity === 2
          ? "\n\n⚠️ Intensity 2 — a second confirmation step will follow."
          : "";
      return (
        `Manual post mode: Approve accepts this draft and sends a copy-paste notify. ` +
        `You post on Reddit yourself — nothing is auto-commented.` +
        intensityNote
      );
    }
    if (fp.type === "approval" && draft.intensity === 2) {
      return (
        `${fp.description}\n\n⚠️ Intensity 2 draft — a second confirmation step will follow.`
      );
    }
    return undefined;
  }

  async buildFeedbackOptions(
    stage: StageDefinition,
    fp: FeedbackPoint,
    context: AgentContext
  ): Promise<string[] | undefined> {
    if (
      (stage.name === "discover" ||
        (stage.name === "scout" && context.emptyScoutFallbackActive)) &&
      fp.type === "choice"
    ) {
      const candidates = (context.discoveryCandidates ?? []) as DiscoveryCandidate[];
      return discoveryChoiceOptions(candidates);
    }
    return undefined;
  }

  private async runDiscover(ctx: AgentContext): Promise<void> {
    const result = await runDiscovery({
      memory: this.options.memory,
      store: getAllowlistStore(),
      forceDiscover: Boolean(ctx.forceDiscover),
    });
    ctx.discoveryCandidates = result.candidates;
    ctx.discoverRan = result.ran;
    // For empty-scout fallback predicate (auto:healthy vs other skips).
    if (!result.ran && result.skippedReason) {
      ctx.discoverSkipReason = result.skippedReason;
    } else {
      delete ctx.discoverSkipReason;
    }

    if (result.challenge) {
      setInterstitialSession({
        engine: result.challenge.engine,
        storagePath: result.challenge.storagePath,
        url: result.challenge.url,
        subreddit: "discover",
        blockedSubs: ["discover"],
      });

      if (result.challenge.reason === "login_wall") {
        const loginOutcome = await this.prepareLoginWallSession();
        if (loginOutcome === "logged_in") {
          console.log(
            "[discover] login wall cleared with env credentials — continuing discovery"
          );
          await this.continueDiscoveryAfterClear(
            ctx,
            getInterstitialSession()
          );
          return;
        }
        ctx.discoverChallenge = {
          url: result.challenge.url,
          reason: "login_wall",
          title: result.challenge.title,
          storagePath: result.challenge.storagePath,
        };
        console.log(
          "[discover] paused for LOGIN credentials — form open; reply via Telegram/CLI"
        );
      } else {
        ctx.discoverChallenge = {
          url: result.challenge.url,
          reason: result.challenge.reason,
          title: result.challenge.title,
          storagePath: result.challenge.storagePath,
        };
        console.log(
          "[discover] paused for CAPTCHA HITL — headed browser left open; auto-detects clear (or Approve)"
        );
      }
    }

    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      discover: {
        enabled: result.enabled,
        ran: result.ran,
        skippedReason: result.skippedReason,
        candidateCount: result.candidates.length,
        candidateNames: result.candidates.map((c) => c.name),
        decision: "none",
        captcha: result.challenge ? result.challenge.reason : undefined,
      } satisfies DiscoverEvidence,
    };
  }

  /**
   * Approve / auto-clear → save jar, continue discovery in the SAME headed
   * browser (opening a new Chromium re-triggers Reddit's humanity wall).
   * Abort → soft-abort: close window without save; continue to scout.
   */
  private async applyDiscoverCaptchaFeedback(
    feedback: FeedbackResponse
  ): Promise<boolean> {
    const ctx = this.options.getContext();

    if (isAbortResponse(feedback)) {
      await clearInterstitialSession(false);
      delete ctx.discoverChallenge;
      console.warn(
        "[discover] CAPTCHA HITL aborted — cookies not saved; continuing without new proposals"
      );
      ctx.stageResults = {
        ...(ctx.stageResults ?? {}),
        discover: {
          ...((ctx.stageResults?.discover as object) ?? {}),
          captcha: "skipped",
        },
      };
      return false;
    }

    const live = getInterstitialSession();
    const saved = live
      ? await saveInterstitialCookies()
      : await clearInterstitialSession(true);

    delete ctx.discoverChallenge;
    console.log(
      `[discover] CAPTCHA cleared — jar ${saved ? `saved → ${saved}` : "save failed"}; ` +
        `${live ? "continuing in same browser" : "retrying with new session"}`
    );

    const retry = await this.continueDiscoveryAfterClear(ctx, live);
    return retry;
  }

  /**
   * Run discovery after CAPTCHA clear. Prefers the live headed engine.
   * If Reddit challenges again, wait in that same window (confirmation FP
   * is already consumed — we cannot re-HITL via Telegram).
   */
  private async continueDiscoveryAfterClear(
    ctx: AgentContext,
    live: ReturnType<typeof getInterstitialSession>
  ): Promise<boolean> {
    const memory = this.options.memory;
    const store = getAllowlistStore();
    const maxRounds = 3;
    let adopt = live
      ? { engine: live.engine, storagePath: live.storagePath }
      : undefined;

    for (let round = 0; round < maxRounds; round++) {
      const result = await runDiscovery({
        memory,
        store,
        adopt,
        forceDiscover: true,
      });
      ctx.discoveryCandidates = result.candidates;
      ctx.discoverRan = result.ran;
      if (!result.ran && result.skippedReason) {
        ctx.discoverSkipReason = result.skippedReason;
      } else {
        delete ctx.discoverSkipReason;
      }

      if (!result.challenge) {
        await clearInterstitialSession(true);
        ctx.stageResults = {
          ...(ctx.stageResults ?? {}),
          discover: {
            enabled: result.enabled,
            ran: result.ran,
            skippedReason: result.skippedReason,
            candidateCount: result.candidates.length,
            candidateNames: result.candidates.map((c) => c.name),
            decision: "none",
            captcha: "cleared",
          } satisfies DiscoverEvidence,
        };
        return true;
      }

      setInterstitialSession({
        engine: result.challenge.engine,
        storagePath: result.challenge.storagePath,
        url: result.challenge.url,
        subreddit: "discover",
        blockedSubs: ["discover"],
      });
      adopt = {
        engine: result.challenge.engine,
        storagePath: result.challenge.storagePath,
      };

      console.warn(
        `[discover] blocked again (${result.challenge.reason}) in same window — ` +
          `waiting for clear (round ${round + 1}/${maxRounds})…`
      );

      const page = await result.challenge.engine.getPage();
      const cleared = await this.waitForInterstitialClear(page, 300_000);
      if (!cleared) {
        console.warn(
          "[discover] still blocked after wait — tearing down; scout will use existing allowlist"
        );
        await clearInterstitialSession(false);
        ctx.discoveryCandidates = [];
        ctx.stageResults = {
          ...(ctx.stageResults ?? {}),
          discover: {
            enabled: true,
            count: 0,
            captcha: "still_blocked",
            skippedReason: result.skippedReason,
          },
        };
        return true;
      }

      await saveInterstitialCookies();
      console.log("[discover] wall cleared again — resuming discovery in same browser");
    }

    console.warn("[discover] exceeded clear/retry rounds — giving up");
    await clearInterstitialSession(false);
    ctx.discoveryCandidates = [];
    return true;
  }

  private async waitForInterstitialClear(
    page: import("playwright").Page,
    timeoutMs: number
  ): Promise<boolean> {
    const pollMs = Number(process.env.REDDIT_INTERSTITIAL_POLL_MS ?? "2000");
    const interval = Number.isFinite(pollMs) && pollMs >= 500 ? pollMs : 2000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const wall = await detectInterstitial(page);
        if (!wall.challenged) return true;
      } catch {
        /* page mid-navigation */
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    try {
      return !(await detectInterstitial(page)).challenged;
    } catch {
      return false;
    }
  }

  private async applyDiscoverFeedback(
    feedback: FeedbackResponse
  ): Promise<boolean> {
    const ctx = this.options.getContext();
    // Soft-abort: skip promotion and continue to scout.
    if (isAbortResponse(feedback)) {
      console.log("[discover] aborted — no allowlist promotion");
      this.patchDiscoverEvidence(ctx, { decision: "abort" });
      return false;
    }

    const candidates = (ctx.discoveryCandidates ?? []) as DiscoveryCandidate[];
    const parsed = parseDiscoveryChoices(
      feedback.value,
      candidates.map((c) => c.name)
    );
    if (parsed.action === "skip") {
      console.log("[discover] skipped promotion");
      this.patchDiscoverEvidence(ctx, { decision: "skip" });
      return true;
    }

    const store = getAllowlistStore();
    const promotedNames: string[] = [];
    let firstMemory: MemoryWriteEvidence | undefined;
    const preferDomain = communityFactDomain("preference");
    const rulesDomain = communityFactDomain("rules");

    for (const name of parsed.names) {
      const promoted = await store.promote(name);
      if (!promoted) {
        console.warn(`[discover] promote failed for r/${name}`);
        continue;
      }
      promotedNames.push(promoted.name);

      const eventId = `promote:${promoted.name}`;
      const facets = [
        preferDomain
          ? {
              content: CommunityMemory.allowlistPromoted(
                promoted.name,
                promoted.note
              ),
              domain: preferDomain,
            }
          : null,
        rulesDomain
          ? {
              content: CommunityMemory.subredditRules(
                promoted.name,
                promoted.note
              ),
              domain: rulesDomain,
            }
          : null,
      ].filter((f): f is { content: string; domain: string } => Boolean(f));

      const written = await this.options.memory.addEvent(eventId, facets, {
        source: `relay:${APP_ID}`,
      });
      if (!firstMemory) {
        firstMemory = {
          attempted: facets.length > 0,
          ok: written.length > 0,
          domain: preferDomain,
          outcome: "promote",
          eventId,
          action: written[0]?.action,
        };
      }
      console.log(
        `[discover] promoted r/${promoted.name} → postable allowlist` +
          (written.length
            ? ` (event=${eventId} action=${written[0]?.action ?? "?"})`
            : " (voltmem event skipped/fail-open)")
      );
    }

    if (promotedNames.length === 0) {
      this.patchDiscoverEvidence(ctx, { decision: "skip" });
      return true;
    }

    ctx.lastPromotedSubreddit = promotedNames[0];
    this.patchDiscoverEvidence(ctx, {
      decision: "promote",
      promoted: promotedNames[0],
      promotedNames,
      memory: firstMemory,
    });
    return true;
  }

  private async runEnsureSessionStart(ctx: AgentContext): Promise<void> {
    const cfg = getCommunityConfig();
    const force =
      process.env.REDDIT_ENSURE_SESSION === "true" ||
      process.env.REDDIT_ENSURE_SESSION === "1";

    if (await hasStorageState(cfg.reddit)) {
      const result: EnsureSessionResult = { ok: true, source: "jar" };
      this.setEnsureSession(ctx, result);
      console.log("[ensure_session] cookie jar present — skip login");
      return;
    }

    if (cfg.reddit.hasUserPass) {
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

    const cfg = getCommunityConfig();
    const login = await loginRedditBrowser({
      cfg,
      username: creds.username,
      password: creds.password,
      clearJar: true,
      headless: false,
      onChallenge: async (info) => {
        console.warn(`[ensure_session] ${info.hint}`);
        const text =
          `🔐 Reddit login needs a step in the headed browser.\n` +
          `${info.hint}\n` +
          `${info.url}\n` +
          `Finish CAPTCHA / 2FA there — we auto-continue when login completes (reddit_session).`;
        try {
          await this.options.adapter?.notify?.(text);
        } catch (err) {
          console.warn("[ensure_session] notify failed:", err);
        }
      },
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
   * Browser scout needs a cookie jar even when dry-run (read path).
   * OAuth/fixtures/json do not. Force with REDDIT_ENSURE_SESSION=true always works.
   */
  private sessionRequiredForRun(cfg: CommunityRuntimeConfig): boolean {
    if (cfg.reddit.transport === "oauth" && cfg.reddit.oauthConfigured) return false;
    if (cfg.reddit.transport === "fixtures" || cfg.reddit.transport === "json") return false;
    if (cfg.reddit.transport === "browser" || cfg.reddit.transport === "auto") return true;
    return !cfg.reddit.dryRun;
  }

  private setEnsureSession(ctx: AgentContext, result: EnsureSessionResult): void {
    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      ensure_session: result,
    };
  }

  private async runScout(
    ctx: AgentContext,
    opts?: { isFallbackRescout?: boolean }
  ): Promise<void> {
    const cfg = getCommunityConfig();
    const store = getAllowlistStore();
    const prefer =
      typeof ctx.lastPromotedSubreddit === "string"
        ? ctx.lastPromotedSubreddit
        : undefined;
    const subreddits = await store.pickScoutSubs(
      cfg.scout.maxSubs,
      cfg.discover.exploreSlot,
      prefer ? { prefer } : undefined
    );
    await store.recordScouted(subreddits);
    console.log(
      `[scout] allowlist (${subreddits.length}): ${subreddits
        .map((s) => `r/${s}`)
        .join(", ")}` + (opts?.isFallbackRescout ? " · empty-scout fallback re-scout" : "")
    );

    const prior = await this.options.store.list({
      appId: APP_ID,
      limit: 500,
    });
    const excludeIds = prior.map((r) => r.id);

    const result = await scoutOpportunities({
      limit: 5,
      subreddits,
      excludeIds,
    });
    await this.applyScoutResult(ctx, result, excludeIds.length);

    if (!opts?.isFallbackRescout) {
      const pendingHitl = await this.maybeBeginEmptyScoutDiscoverFallback(
        ctx,
        result,
        excludeIds.length
      );
      if (pendingHitl) {
        // Discover choice / challenge HITL runs via scout feedback_points next.
        return;
      }
      // Fallback already re-scouted + applied cadence inside finishEmptyScoutFallbackRescout.
      if (ctx.discoverEmptyScoutFallbackDone) return;
    }

    // Cadence used to run only after post_watch (same parent). Engage no longer
    // includes that stage — trim scout opportunities here before jobs fanout.
    await this.applyCadenceGate(ctx);
  }

  /**
   * After an empty first scout, optionally force discover once.
   * @returns true when HITL must run before re-scout (leave scout FPs active).
   */
  private async maybeBeginEmptyScoutDiscoverFallback(
    ctx: AgentContext,
    scoutResult: Awaited<ReturnType<typeof scoutOpportunities>>,
    excludedSeen: number
  ): Promise<boolean> {
    const cfg = getCommunityConfig();
    const dailyCount = await readEmptyScoutFallbackDailyCount(
      cfg.reddit.dataDir
    );
    const decision = shouldTriggerEmptyScoutFallback({
      onEmptyScout: cfg.discover.onEmptyScout,
      discoverMode: cfg.discover.mode,
      onEmptyScoutMax: cfg.discover.onEmptyScoutMax,
      onEmptyScoutMaxPerDay: cfg.discover.onEmptyScoutMaxPerDay,
      dailyCount,
      opportunityCount: scoutResult.drafts.length,
      discoverRan: Boolean(ctx.discoverRan),
      discoverSkipReason:
        typeof ctx.discoverSkipReason === "string"
          ? ctx.discoverSkipReason
          : undefined,
      discoverEmptyScoutAttempts: Number(ctx.discoverEmptyScoutAttempts ?? 0),
      discoverEmptyScoutFallbackDone: Boolean(
        ctx.discoverEmptyScoutFallbackDone
      ),
      excludedSeen,
      hasChallenge: Boolean(scoutResult.challenge || ctx.interstitialChallenge),
      report: scoutResult.report,
    });

    if (!decision.ok) {
      if (cfg.discover.onEmptyScout === "force") {
        console.log(`[discover] empty-scout fallback skipped — ${decision.reason}`);
      }
      return false;
    }

    const attempts = Number(ctx.discoverEmptyScoutAttempts ?? 0) + 1;
    ctx.discoverEmptyScoutAttempts = attempts;
    const dayAfter = await incrementEmptyScoutFallbackDailyCount(
      cfg.reddit.dataDir
    );
    console.log(
      `[discover] empty-scout fallback attempt ${attempts}/${cfg.discover.onEmptyScoutMax}` +
        ` (day ${dayAfter}/${cfg.discover.onEmptyScoutMaxPerDay}) — ${decision.reason}`
    );

    ctx.forceDiscover = true;
    ctx.emptyScoutFallbackActive = true;
    try {
      await this.runDiscover(ctx);
    } finally {
      delete ctx.forceDiscover;
    }

    const candidates = (ctx.discoveryCandidates ?? []) as DiscoveryCandidate[];
    const discoverChallenge = ctx.discoverChallenge as
      | { reason?: string }
      | undefined;

    if (discoverChallenge) {
      console.log(
        "[discover] empty-scout fallback paused for discover HITL (challenge)"
      );
      return true;
    }

    if (candidates.length > 0) {
      console.log(
        `[discover] empty-scout fallback paused for promote HITL (${candidates.length} candidate(s))`
      );
      return true;
    }

    console.log(
      "[discover] empty-scout fallback: no new postable — re-scouting once"
    );
    await this.finishEmptyScoutFallbackRescout(ctx);
    return false;
  }

  /** After promote/skip/challenge resolve — one re-scout, then mark done. */
  private async finishEmptyScoutFallbackRescout(
    ctx: AgentContext
  ): Promise<void> {
    ctx.discoverEmptyScoutFallbackDone = true;
    delete ctx.emptyScoutFallbackActive;
    delete ctx.discoveryCandidates;
    delete ctx.discoverChallenge;
    await this.runScout(ctx, { isFallbackRescout: true });
  }

  /**
   * Scout-stage HITL while empty-scout fallback discover is in flight.
   * Soft-abort (false) keeps the engage run going into re-scout.
   */
  private async applyEmptyScoutFallbackHitl(
    feedback: FeedbackResponse
  ): Promise<boolean> {
    const ctx = this.options.getContext();
    const hadChallenge = Boolean(ctx.discoverChallenge);
    let result: void | boolean;
    if (
      (ctx.discoverChallenge as { reason?: string } | undefined)?.reason ===
      "login_wall"
    ) {
      result = await this.applyDiscoverLoginFeedback(feedback);
    } else if (ctx.discoverChallenge) {
      result = await this.applyDiscoverCaptchaFeedback(feedback);
    } else {
      result = await this.applyDiscoverFeedback(feedback);
    }
    this.finishDiscoverHitlWait(feedback);
    this.finishScoutHitlWait();

    // Still need another discover HITL round (e.g. captcha then choice).
    if (ctx.discoverChallenge) {
      return typeof result === "boolean" ? result : true;
    }
    const candidates = (ctx.discoveryCandidates ?? []) as DiscoveryCandidate[];
    // Login/captcha clear may have produced candidates — choice FP still pending.
    if (candidates.length > 0 && hadChallenge) {
      return typeof result === "boolean" ? result : true;
    }

    if (candidates.length === 0 && !ctx.lastPromotedSubreddit) {
      console.log(
        "[discover] empty-scout fallback: no new postable after HITL — re-scouting once"
      );
    }

    await this.finishEmptyScoutFallbackRescout(ctx);
    // Soft-continue after abort so jobs still run (possibly empty).
    return false;
  }

  /**
   * Poll enrolled live posts for replies/removal; set follow-up drafts as
   * opportunities for the jobs fanout (own entrypoint — not part of engage).
   */
  private async runPostWatch(ctx: AgentContext): Promise<void> {
    const cfg = getCommunityConfig();
    try {
      if (!cfg.postWatch.enabled) {
        console.log("[post-watch] disabled — skipping");
        ctx.stageResults = {
          ...(ctx.stageResults ?? {}),
          post_watch: { skipped: true, reason: "disabled" },
        };
      } else {
        let result;
        try {
          result = await processDuePostWatches(cfg);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[post-watch] process failed: ${message}`);
          ctx.stageResults = {
            ...(ctx.stageResults ?? {}),
            post_watch: { ok: false, error: message },
          };
          return;
        }

        console.log(formatPostWatchLog(result));
        const existing =
          (ctx.opportunities as CommunityDraft[] | undefined) ?? [];
        if (result.followUps.length > 0) {
          ctx.opportunities = [...result.followUps, ...existing];
          console.log(
            `[post-watch] prepended ${result.followUps.length} follow-up draft(s)`
          );
        }

        let outcomeTagsWritten = 0;
        if (result.outcomeHints.length > 0) {
          try {
            const written = await writeOutcomeTagHints(
              this.options.memory,
              result.outcomeHints
            );
            outcomeTagsWritten = written.filter((w) => w.ok).length;
          } catch (err) {
            console.warn("[post-watch] outcome tag write failed:", err);
          }
        }

        ctx.stageResults = {
          ...(ctx.stageResults ?? {}),
          post_watch: {
            checked: result.checked,
            replied: result.replied,
            removed: result.removed,
            expired: result.expired,
            errors: result.errors,
            followUpIds: result.followUps.map((d) => d.id),
            outcomeHints: result.outcomeHints.map((h) => h.tag),
            outcomeTagsWritten,
          },
        };
      }
    } finally {
      await this.applyCadenceGate(ctx);
    }
  }

  /**
   * Cap opportunities by remaining daily help/promo slots (ledger-backed).
   * Runs after post_watch so follow-ups are included before jobs fanout.
   */
  private async applyCadenceGate(ctx: AgentContext): Promise<void> {
    const cfg = getCommunityConfig();
    const cadence = await resolveCadenceStatus(cfg);
    ctx.cadenceStatus = cadence;
    console.log(formatCadenceLog(cadence));

    const before =
      (ctx.opportunities as CommunityDraft[] | undefined) ?? [];
    const after = trimOpportunitiesForCadence(before, cadence);
    if (after.length !== before.length) {
      ctx.opportunities = after;
      console.log(
        `[cadence] trimmed opportunities ${before.length} → ${after.length}` +
          (cadence.dayExhausted ? " (day exhausted)" : "")
      );
    }

    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      cadence: {
        enabled: cadence.enabled,
        dayKey: cadence.dayKey,
        helpPostedToday: cadence.helpPostedToday,
        promoPostedToday: cadence.promoPostedToday,
        helpRemaining: cadence.helpRemaining,
        promoRemaining: cadence.promoRemaining,
        dayExhausted: cadence.dayExhausted,
        trimmedFrom: before.length,
        trimmedTo: after.length,
      },
    };
  }

  /**
   * Continue scout in the live headed browser after login/CAPTCHA HITL.
   * Skips re-prompting login for `skipSub` if still gated; scouts the rest.
   *
   * If Reddit challenges again, wait in the same window — the scout
   * confirmation FP is already consumed, so we cannot re-HITL via Telegram
   * (same pattern as continueDiscoveryAfterClear).
   */
  private async continueScoutInSession(
    ctx: AgentContext,
    live: NonNullable<ReturnType<typeof getInterstitialSession>>,
    skipSub: string
  ): Promise<void> {
    const cfg = getCommunityConfig();
    const store = getAllowlistStore();
    const prefer =
      typeof ctx.lastPromotedSubreddit === "string"
        ? ctx.lastPromotedSubreddit
        : undefined;
    const subreddits = await store.pickScoutSubs(
      cfg.scout.maxSubs,
      cfg.discover.exploreSlot,
      prefer ? { prefer } : undefined
    );
    await store.recordScouted(subreddits);
    const prior = await this.options.store.list({
      appId: APP_ID,
      limit: 500,
    });
    const excludeIds = prior.map((r) => r.id);

    console.log(
      `[scout] continuing in same headed browser after challenge clear ` +
        `(skip re-HITL for r/${skipSub})`
    );

    let adopt: { engine: typeof live.engine; storagePath: string } = {
      engine: live.engine,
      storagePath: live.storagePath,
    };
    const skipHitl = new Set([skipSub.replace(/^r\//i, "").toLowerCase()]);
    const maxRounds = 3;

    for (let round = 0; round < maxRounds; round++) {
      const result = await scoutOpportunities({
        limit: 5,
        subreddits,
        excludeIds,
        adopt,
        skipLoginHitlSubs: [...skipHitl],
      });

      if (!result.challenge) {
        await this.applyScoutResult(ctx, result, excludeIds.length);
        if (!ctx.interstitialChallenge) {
          await clearInterstitialSession(true);
        }
        return;
      }

      // applyScoutResult would set interstitialChallenge for Telegram — but
      // confirmation FP is consumed. Wait inline instead.
      setInterstitialSession({
        engine: result.challenge.engine,
        storagePath: result.challenge.storagePath,
        url: result.challenge.url,
        subreddit: result.challenge.subreddit,
        blockedSubs: result.blocked
          .filter((b) => b.reason !== "rate_limit")
          .map((b) => b.subreddit),
      });
      adopt = {
        engine: result.challenge.engine,
        storagePath: result.challenge.storagePath,
      };
      skipHitl.add(result.challenge.subreddit.toLowerCase());

      console.warn(
        `[scout] blocked again (${result.challenge.reason}) on r/${result.challenge.subreddit} ` +
          `in same window — waiting for clear (round ${round + 1}/${maxRounds})…`
      );
      try {
        await this.options.adapter?.notify?.(
          `🔐 Reddit challenged again (r/${result.challenge.subreddit}, ${result.challenge.reason}).\n` +
            `Solve it in the headed browser — we auto-continue when it clears.`
        );
      } catch {
        /* ignore */
      }

      const page = await result.challenge.engine.getPage();
      const cleared = await this.waitForInterstitialClear(page, 300_000);
      if (!cleared) {
        console.warn(
          "[scout] still blocked after wait — keeping drafts so far; tearing down"
        );
        await this.applyScoutResult(
          ctx,
          { ...result, challenge: undefined },
          excludeIds.length
        );
        delete ctx.interstitialChallenge;
        await clearInterstitialSession(false);
        return;
      }

      await saveInterstitialCookies();
      console.log(
        "[scout] wall cleared again — resuming scout in same headed browser"
      );
    }

    console.warn("[scout] exceeded clear/retry rounds — giving up continue");
    await clearInterstitialSession(false);
    delete ctx.interstitialChallenge;
  }

  private async applyScoutResult(
    ctx: AgentContext,
    result: Awaited<ReturnType<typeof scoutOpportunities>>,
    excludedSeen: number
  ): Promise<void> {
    const opportunities = result.drafts;

    console.log(
      `[scout] ${opportunities.length} actionable (score ≥ ${ACTIONABLE_SCORE_MIN}/${SCORE_MAX}) via ${result.source}` +
        (excludedSeen ? ` · excluded ${excludedSeen} already-seen` : "")
    );
    for (const d of opportunities) {
      console.log(
        `  - [${scoreTotal(d.score)}/${SCORE_MAX}] r/${d.subreddit} · ${d.threadTitle}`
      );
    }
    ctx.opportunities = opportunities;
    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      scout: {
        count: opportunities.length,
        ids: opportunities.map((d) => d.id),
        source: result.source,
        blocked: result.blocked,
        timedOut: result.timedOut,
        excludedSeen,
        report: result.report,
      },
    };

    if (result.challenge) {
      setInterstitialSession({
        engine: result.challenge.engine,
        storagePath: result.challenge.storagePath,
        url: result.challenge.url,
        subreddit: result.challenge.subreddit,
        blockedSubs: result.blocked
          .filter((b) => b.reason !== "rate_limit")
          .map((b) => b.subreddit),
      });

      if (result.challenge.reason === "login_wall") {
        const loginOutcome = await this.prepareLoginWallSession();
        if (loginOutcome === "logged_in") {
          const live = getInterstitialSession();
          if (live) {
            console.log(
              "[scout] login wall cleared with env credentials — continuing in same browser"
            );
            delete ctx.interstitialChallenge;
            await this.continueScoutInSession(
              ctx,
              live,
              result.challenge.subreddit
            );
            return;
          }
        }
        ctx.interstitialChallenge = {
          url: result.challenge.url,
          subreddit: result.challenge.subreddit,
          blockedSubs: result.blocked
            .filter((b) => b.reason !== "rate_limit")
            .map((b) => b.subreddit),
          storagePath: result.challenge.storagePath,
          reason: "login_wall",
          live: true,
        };
        console.log(
          `[scout] paused for LOGIN credentials on r/${result.challenge.subreddit} — ` +
            `form open; reply via Telegram/CLI`
        );
        return;
      }

      ctx.interstitialChallenge = {
        url: result.challenge.url,
        subreddit: result.challenge.subreddit,
        blockedSubs: result.blocked
          .filter((b) => b.reason !== "rate_limit")
          .map((b) => b.subreddit),
        storagePath: result.challenge.storagePath,
        reason: result.challenge.reason,
        live: true,
      };
      console.log(
        `[scout] paused for CAPTCHA HITL on r/${result.challenge.subreddit} — ` +
          `browser left open; auto-detects clear (or Approve)`
      );
      return;
    }

    await this.maybeEscalateInterstitial(ctx, result.blocked);
  }

  /**
   * Fallback when browser scout did not hand off a live window.
   * With interstitialHitl, always park a headed browser and set
   * interstitialChallenge so the runtime WAITS for Telegram/CLI — never
   * "cleared without HITL" and proceed.
   */
  private async maybeEscalateInterstitial(
    ctx: AgentContext,
    blocked: Array<{ subreddit: string; url: string; reason: string }>
  ): Promise<void> {
    const cfg = getCommunityConfig();
    if (blocked.length === 0) return;

    // Rate-limit / already-handled login walls need cool-down or skip — not a
    // fresh headed CAPTCHA window. Credential HITL only comes from live handoff.
    const captchaBlocked = blocked.filter(
      (b) =>
        b.reason !== "rate_limit" &&
        b.reason !== "login_wall" &&
        b.reason !== "login_pending" &&
        b.reason !== "skipped_after_hitl"
    );
    const rateLimited = blocked.filter((b) => b.reason === "rate_limit");
    const loginSkipped = blocked.filter(
      (b) => b.reason === "login_wall" || b.reason === "skipped_after_hitl"
    );
    if (rateLimited.length > 0) {
      console.warn(
        `[scout] rate-limited on ${rateLimited.map((b) => `r/${b.subreddit}`).join(", ")} — ` +
          `wait several minutes; raise REDDIT_SCOUT_DELAY_MS / lower REDDIT_SCOUT_MAX_SUBS`
      );
    }
    if (loginSkipped.length > 0) {
      console.warn(
        `[scout] skipped login-gated sub(s) after HITL: ${loginSkipped
          .map((b) => `r/${b.subreddit}`)
          .join(", ")}`
      );
    }
    if (captchaBlocked.length === 0) return;

    if (!cfg.reddit.interstitialHitl) {
      console.warn(
        `[scout] ${captchaBlocked.length} sub(s) blocked by interstitial — unattended mode ` +
          `(set REDDIT_INTERSTITIAL_HITL=true or run headed to escalate via Telegram/CLI)`
      );
      return;
    }

    const first = captchaBlocked[0]!;
    console.log(
      `[scout] escalating interstitial for r/${first.subreddit} — opening headed browser and pausing for Approve`
    );

    const { engine, storagePath } = await createRedditBrowserEngine({
      cfg,
      useStoredSession: true,
      headless: false,
    });

    try {
      const page = await engine.getPage();
      await page.goto(first.url, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      const wall = await detectInterstitial(page);
      if (!wall.challenged) {
        console.log(
          "[scout] CAPTCHA not visible on re-open — keeping headed window open; " +
            "Approve in Telegram/CLI when the page looks clear (or Abort to skip)"
        );
      } else {
        console.log(
          `[scout] CAPTCHA still showing (${wall.reason}) — solve in the headed window, then Approve`
        );
      }
    } catch (err) {
      console.warn("[scout] failed to open interstitial window:", err);
      try {
        await engine.teardown();
      } catch {
        /* ignore */
      }
      return;
    }

    setInterstitialSession({
      engine,
      storagePath,
      url: first.url,
      subreddit: first.subreddit,
      blockedSubs: captchaBlocked.map((b) => b.subreddit),
    });

    if (first.reason === "login_wall") {
      const loginOutcome = await this.prepareLoginWallSession();
      if (loginOutcome === "logged_in") {
        const live = getInterstitialSession();
        if (live) {
          console.log(
            "[scout] login wall cleared with env credentials after escalate — continuing in same browser"
          );
          delete ctx.interstitialChallenge;
          await this.continueScoutInSession(ctx, live, first.subreddit);
          return;
        }
      }
      ctx.interstitialChallenge = {
        url: first.url,
        subreddit: first.subreddit,
        blockedSubs: captchaBlocked.map((b) => b.subreddit),
        storagePath: storageStatePath(cfg.reddit),
        reason: "login_wall",
      };
      console.log(
        "[scout] WAITING for Reddit credentials via Telegram/CLI (login form open)"
      );
      return;
    }

    ctx.interstitialChallenge = {
      url: first.url,
      subreddit: first.subreddit,
      blockedSubs: captchaBlocked.map((b) => b.subreddit),
      storagePath: storageStatePath(cfg.reddit),
      reason: first.reason,
    };
    console.log(
      "[scout] WAITING for human CAPTCHA solve via Telegram/CLI before continuing"
    );
  }

  /**
   * Click Log In on the headed interstitial session. If env credentials exist,
   * try an unattended fill first. Returns logged_in when the jar was saved.
   */
  private async prepareLoginWallSession(): Promise<
    "logged_in" | "credentials_needed"
  > {
    const session = getInterstitialSession();
    if (!session) return "credentials_needed";

    const onChallenge = async (info: { url: string; hint: string }) => {
      console.warn(`[login-wall] ${info.hint}`);
      const text =
        `🔐 Reddit needs a CAPTCHA / security check in the headed browser before login.\n` +
        `${info.hint}\n` +
        `${info.url}\n` +
        `Solve it there — we auto-continue when the login form appears.`;
      try {
        await this.options.adapter?.notify?.(text);
      } catch (err) {
        console.warn("[login-wall] notify failed:", err);
      }
    };

    try {
      const page = await session.engine.getPage();
      await openRedditLoginForm(page, { onChallenge });
      console.log("[login-wall] login form open in headed browser");

      const cfg = getCommunityConfig();
      const username = cfg.reddit.username?.trim();
      const password = cfg.reddit.password;
      if (username && password) {
        console.log(
          `[login-wall] trying env credentials as u/${username}…`
        );
        await fillAndSubmitRedditLogin(page, username, password, {
          onChallenge,
        });
        if (await waitUntilRedditLoggedIn(page, 45_000)) {
          await saveInterstitialCookies();
          console.log(
            `[login-wall] env login ok — jar saved (window kept open for continue)`
          );
          return "logged_in";
        }
        console.warn(
          "[login-wall] env credentials did not finish login — requesting HITL credentials"
        );
        await openRedditLoginForm(page, { onChallenge });
      }
    } catch (err) {
      console.warn("[login-wall] failed to open/fill login form:", err);
    }
    return "credentials_needed";
  }

  /**
   * Telegram/CLI credentials → fill headed browser → save jar → continue
   * scout in the SAME browser (skip re-HITL for that sub if still gated).
   */
  private async applyLoginWallCredentialFeedback(
    feedback: FeedbackResponse
  ): Promise<boolean | void> {
    const ctx = this.options.getContext();

    if (isAbortResponse(feedback)) {
      await clearInterstitialSession(false);
      delete ctx.interstitialChallenge;
      console.warn(
        "[scout] login HITL aborted — cookies not saved; continuing run"
      );
      ctx.stageResults = {
        ...(ctx.stageResults ?? {}),
        scout: {
          ...((ctx.stageResults?.scout as object) ?? {}),
          interstitial: "login_skipped",
        },
      };
      return false;
    }

    const creds = parseCredentialValue(feedback.value);
    if (!creds) {
      throw new Error(
        "scout login wall: expected username\\npassword (or { username, password })"
      );
    }

    const session = getInterstitialSession();
    if (!session) {
      throw new Error("scout login wall: no headed browser session");
    }

    const skipSub =
      (ctx.interstitialChallenge as { subreddit?: string } | undefined)
        ?.subreddit ?? session.subreddit;

    console.log(`[scout] filling Reddit login as u/${creds.username}…`);
    const page = await session.engine.getPage();
    await fillAndSubmitRedditLogin(page, creds.username, creds.password, {
      onChallenge: async (info) => {
        console.warn(`[scout] ${info.hint}`);
        try {
          await this.options.adapter?.notify?.(
            `🔐 ${info.hint}\n${info.url}\nSolve in the headed browser — we auto-continue when ready.`
          );
        } catch {
          /* ignore */
        }
      },
    });

    if (await waitUntilRedditLoggedIn(page, 60_000)) {
      await saveInterstitialCookies();
      delete ctx.interstitialChallenge;
      ctx.stageResults = {
        ...(ctx.stageResults ?? {}),
        scout: {
          ...((ctx.stageResults?.scout as object) ?? {}),
          interstitial: "logged_in",
          storagePath: session.storagePath,
        },
      };
      console.log(
        "[scout] login ok (reddit_session) — continuing scout in same headed browser"
      );
      await this.continueScoutInSession(ctx, session, skipSub);
      return;
    }

    // Password accepted but 2FA/CAPTCHA may remain — confirmation FP next.
    const prior = ctx.interstitialChallenge as Record<string, unknown> | undefined;
    ctx.interstitialChallenge = {
      ...(prior ?? {}),
      reason: "login_pending",
      url: page.url(),
    };
    console.log(
      "[scout] credentials submitted — finish 2FA/CAPTCHA in the headed window (auto-detect or Approve)"
    );
  }

  /** Discover-stage login wall: same fill/save, then retry discovery. */
  private async applyDiscoverLoginFeedback(
    feedback: FeedbackResponse
  ): Promise<boolean> {
    const ctx = this.options.getContext();

    if (isAbortResponse(feedback)) {
      await clearInterstitialSession(false);
      delete ctx.discoverChallenge;
      console.warn(
        "[discover] login HITL aborted — cookies not saved; continuing without new proposals"
      );
      ctx.stageResults = {
        ...(ctx.stageResults ?? {}),
        discover: {
          ...((ctx.stageResults?.discover as object) ?? {}),
          captcha: "login_skipped",
        },
      };
      return false;
    }

    const creds = parseCredentialValue(feedback.value);
    if (!creds) {
      throw new Error(
        "discover login wall: expected username\\npassword (or { username, password })"
      );
    }

    const session = getInterstitialSession();
    if (!session) {
      throw new Error("discover login wall: no headed browser session");
    }

    console.log(`[discover] filling Reddit login as u/${creds.username}…`);
    const page = await session.engine.getPage();
    await fillAndSubmitRedditLogin(page, creds.username, creds.password, {
      onChallenge: async (info) => {
        console.warn(`[discover] ${info.hint}`);
        try {
          await this.options.adapter?.notify?.(
            `🔐 ${info.hint}\n${info.url}\nSolve in the headed browser — we auto-continue when ready.`
          );
        } catch {
          /* ignore */
        }
      },
    });

    if (await waitUntilRedditLoggedIn(page, 60_000)) {
      await saveInterstitialCookies();
      delete ctx.discoverChallenge;
      console.log(
        `[discover] login ok — continuing discovery in same headed browser`
      );
      await this.continueDiscoveryAfterClear(ctx, getInterstitialSession());
      return true;
    }

    // Leave window for confirmation (2FA) if that FP is still pending.
    ctx.discoverChallenge = {
      ...((ctx.discoverChallenge as object) ?? {}),
      reason: "login_pending",
      url: page.url(),
    };
    console.log(
      "[discover] credentials submitted — finish 2FA/CAPTCHA in the headed window"
    );
    return true;
  }

  /**
   * Approve / auto-clear → save jar, continue scout in the SAME headed browser.
   * Abort → soft-abort (return false): tear down without saving; run continues.
   */
  private async applyInterstitialFeedback(
    feedback: FeedbackResponse
  ): Promise<boolean | void> {
    const ctx = this.options.getContext();
    const skipSub =
      (ctx.interstitialChallenge as { subreddit?: string } | undefined)
        ?.subreddit ?? "unknown";

    if (isAbortResponse(feedback)) {
      await clearInterstitialSession(false);
      delete ctx.interstitialChallenge;
      console.warn(
        "[scout] interstitial HITL aborted — cookies not saved; continuing run"
      );
      ctx.stageResults = {
        ...(ctx.stageResults ?? {}),
        scout: {
          ...((ctx.stageResults?.scout as object) ?? {}),
          interstitial: "skipped",
        },
      };
      return false; // soft abort
    }

    const live = getInterstitialSession();
    if (live) {
      await saveInterstitialCookies();
      delete ctx.interstitialChallenge;
      ctx.stageResults = {
        ...(ctx.stageResults ?? {}),
        scout: {
          ...((ctx.stageResults?.scout as object) ?? {}),
          interstitial: "cleared",
          storagePath: live.storagePath,
        },
      };
      console.log(
        "[scout] interstitial cleared — continuing scout in same headed browser"
      );
      await this.continueScoutInSession(ctx, live, skipSub);
      return;
    }

    // No live window — fall back to jar + fresh browser.
    delete ctx.interstitialChallenge;
    console.log(
      "[scout] interstitial HITL approved without live window — retrying scout"
    );
    await this.runScout(ctx);
    if (ctx.interstitialChallenge) {
      console.warn(
        "[scout] still challenged after Approve — tearing down; continuing with current opportunities"
      );
      await clearInterstitialSession(false);
      delete ctx.interstitialChallenge;
    }
  }

  private async runDraft(
    ctx: AgentContext,
    engine?: ExecutionEngine
  ): Promise<void> {
    const top =
      this.options.opportunity ??
      (ctx.opportunity as CommunityDraft | undefined) ??
      this.pickFromQueue(ctx);

    const runtimeCfg = getCommunityConfig();
    const warmup = await resolveWarmupStatus(runtimeCfg);
    ctx.warmupStatus = warmup;
    console.log(formatWarmupLog(warmup));

    // Probe whether a soft-mention (intensity 1) would breach the rolling promo ratio.
    const promo = await resolvePromoRatioStatus(runtimeCfg, {
      proposedIntensity: 1,
    });
    ctx.promoRatioStatus = promo;
    console.log(formatPromoRatioLog(promo));

    const cadence =
      (ctx.cadenceStatus as CadenceStatus | undefined) ??
      (await resolveCadenceStatus(runtimeCfg));
    ctx.cadenceStatus = cadence;
    console.log(formatCadenceLog(cadence));
    if (cadence.enabled && cadence.dayExhausted) {
      throw new Error(
        `cadence day exhausted — help ${cadence.helpPostedToday}/${cadence.maxHelpPerDay}, ` +
          `promo ${cadence.promoPostedToday}/${cadence.maxPromoPerDay} (day ${cadence.dayKey})`
      );
    }
    if (
      cadence.enabled &&
      cadence.helpExhausted &&
      cadence.promoExhausted === false
    ) {
      // Only promo slots left; refuse pure help drafts at execute via intensity check.
      console.log(
        "[cadence] help exhausted — remaining slot(s) are promo-only"
      );
    }

    const allowEntry = await getAllowlistStore().get(top.subreddit);
    const playbook = resolvePlaybook(allowEntry ?? top.subreddit);
    const ledger = await readPromoLedger(runtimeCfg.reddit.dataDir);
    const plugsThisWeek = countPlugsThisWeek(
      ledger.entries,
      top.subreddit
    );
    const plugsWeekBlocked = shouldBlockPlugForWeek(playbook, plugsThisWeek);
    console.log(
      `[playbook] r/${top.subreddit} ${formatPlaybookSummary(playbook)}` +
        ` plugsThisWeek=${plugsThisWeek}` +
        (plugsWeekBlocked ? " BLOCK_PLUGS" : "")
    );
    ctx.playbook = playbook;

    const memoryBlock = await this.options.memory.rememberForPrompt(
      `community reddit draft r/${top.subreddit} ${top.threadTitle} intensity feedback abort approve ${OUTCOME_REMEMBER_TOKENS}`,
      { limit: 5 }
    );
    if (memoryBlock) {
      console.log(`[draft] injected agent memory (${memoryBlock.split("\n").length} lines)`);
    } else {
      console.log(`[draft] no agent memory (engine=${this.options.memory.name})`);
    }
    ctx.agentMemory = memoryBlock;

    const forceIntensity0 =
      warmup.active ||
      promo.blockPromo ||
      plugsWeekBlocked ||
      cadence.promoExhausted;
    const draftOverrides = {
      memoryBlock: memoryBlock || undefined,
      warmupActive: warmup.active,
      forceIntensity0:
        promo.blockPromo || plugsWeekBlocked || cadence.promoExhausted,
      plugsWeekBlocked,
      playbook,
    };
    let drafted: CommunityDraft;
    let provider: DraftProvider = "stub";
    if (engine?.type === "llm") {
      const result = await engine.execute({
        type: "draft_reply",
        params: {
          draft: top,
          overrides: draftOverrides,
        },
      });
      if (!result.success || !result.data?.draft) {
        throw new Error(result.error ?? "llm draft_reply failed");
      }
      drafted = result.data.draft as CommunityDraft;
      if (result.data.provider === "gemini" || result.data.provider === "stub") {
        provider = result.data.provider;
      }
    } else {
      const outcome = await draftReply(top, draftOverrides);
      drafted = outcome.draft;
      provider = outcome.provider;
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
    ctx.feedbackContext = draftToFeedbackContext(drafted, {
      warmup,
      promo,
      cadence,
      playbook,
      plugsThisWeek,
      plugsWeekBlocked,
      postMode: getCommunityConfig().postMode,
    });
    const preview = draftPreview(drafted.draftText);
    const draftEvidence: DraftEvidence = {
      id: drafted.id,
      subreddit: drafted.subreddit,
      scoreTotal: scoreTotal(drafted.score),
      intensity: drafted.intensity,
      memoryUsed: Boolean(memoryBlock),
      memoryChars: memoryBlock?.length ?? 0,
      provider,
      draftChars: drafted.draftText.length,
      warmupActive: warmup.active,
      ...(warmup.active && warmup.reasons.length
        ? { warmupReasons: warmup.reasons }
        : {}),
      promoBlocked: promo.blockPromo,
      promoWarned: promo.warnPromo,
      promoRatio: promo.currentRatio,
      cadenceHelpRemaining: cadence.helpRemaining,
      cadencePromoRemaining: cadence.promoRemaining,
      ...(preview ? { preview } : {}),
    };
    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      draft: draftEvidence,
    };
    console.log(
      `[draft] pending_approval id=${drafted.id} intensity=${drafted.intensity} provider=${provider} chars=${drafted.draftText.length}` +
        (forceIntensity0 ? " helpOnly=1" : "") +
        (promo.warnPromo ? " promoWarn=1" : "")
    );
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

    const runtimeCfg = getCommunityConfig();

    if (runtimeCfg.postMode === "manual") {
      await this.runManualPostNotify(ctx, draft);
      return;
    }

    const warmup =
      (ctx.warmupStatus as WarmupStatus | undefined) ??
      (await resolveWarmupStatus(runtimeCfg));
    const promo =
      (ctx.promoRatioStatus as PromoRatioStatus | undefined) ??
      (await resolvePromoRatioStatus(runtimeCfg, {
        proposedIntensity: draft.intensity,
      }));
    const cadence =
      (ctx.cadenceStatus as CadenceStatus | undefined) ??
      (await resolveCadenceStatus(runtimeCfg));
    const result = await executeApproved(draft, {
      warmupActive: warmup.active,
      promoBlocked: promo.blockPromo,
      cadenceBlocked: cadenceBlocksIntensity(cadence, draft.intensity),
    });
    ctx.executeResult = result;
    let visibility: VisibilityCheckResult | undefined;
    const executeEvidence: ExecuteEvidence = {
      ok: result.ok,
      dryRun: result.dryRun,
      jobId: result.jobId,
      transport: result.transport,
      postedUrl: result.postedUrl,
      idempotentHit: result.idempotentHit,
      error: result.error,
    };
    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      execute: executeEvidence,
    };

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

      if (!result.dryRun && !result.idempotentHit && result.postedUrl) {
        const dataDir = runtimeCfg.reddit.dataDir;
        // Live intensity-0 posts advance the local help-comment warmup counter.
        if (draft.intensity === 0) {
          try {
            const total = await recordHelpCommentPosted(dataDir);
            console.log(`[warmup] help comment recorded (total=${total})`);
          } catch (err) {
            console.warn("[warmup] failed to record help comment:", err);
          }
        }
        // Every live post (help or promo) updates the rolling promo-ratio ledger.
        try {
          const n = await recordPromoLedgerPost(dataDir, {
            intensity: draft.intensity,
            jobId: result.jobId,
            subreddit: draft.subreddit,
            windowDays: runtimeCfg.promo.windowDays,
          });
          console.log(
            `[promo] ledger recorded intensity=${draft.intensity} (windowEntries=${n})`
          );
        } catch (err) {
          console.warn("[promo] failed to record ledger entry:", err);
        }
        // Logged-out permalink check — catch removal/shadowban before post-watch.
        try {
          visibility = await checkCommentVisibility(result.postedUrl, {
            cfg: runtimeCfg,
            jobId: result.jobId,
          });
          ctx.visibilityResult = visibility;
          console.log(formatVisibilityLog(visibility));
          executeEvidence.visibilityOk = visibility.visibilityOk;
          executeEvidence.visibilityStatus = visibility.status;
          if (visibility.error) {
            executeEvidence.visibilityError = visibility.error;
          }
          ctx.stageResults = {
            ...(ctx.stageResults ?? {}),
            execute: executeEvidence,
            visibility: {
              status: visibility.status,
              visibilityOk: visibility.visibilityOk,
              permalink: visibility.permalink,
              author: visibility.author,
              authorMismatch: visibility.authorMismatch,
              error: visibility.error,
            },
          };
          if (!visibility.visibilityOk && visibility.status !== "skipped") {
            console.warn(
              `[visibility] comment not publicly visible after post (${visibility.status}) — check for removal or shadowban`
            );
            try {
              await writeOutcomeTag(this.options.memory, "removed", {
                draftId: draft.id,
                jobId: result.jobId,
                subreddit: draft.subreddit,
                threadUrl: draft.threadUrl,
                threadTitle: draft.threadTitle,
                intensity: draft.intensity,
                note: `visibility=${visibility.status}`,
              });
            } catch (tagErr) {
              console.warn("[visibility] outcome tag write failed:", tagErr);
            }
          }
        } catch (err) {
          console.warn("[visibility] check failed:", err);
        }
        // Enroll for 24–72h reply/removal watch (next parent run).
        if (runtimeCfg.postWatch.enabled) {
          try {
            const watch = await enrollPostWatch(dataDir, {
              postedUrl: result.postedUrl,
              subreddit: draft.subreddit,
              threadUrl: draft.threadUrl,
              threadTitle: draft.threadTitle,
              draftId: draft.id,
              jobId: result.jobId,
              minAgeHours: runtimeCfg.postWatch.minAgeHours,
              maxAgeHours: runtimeCfg.postWatch.maxAgeHours,
            });
            console.log(
              `[post-watch] enrolled ${watch.id} checkAfter=${watch.checkAfter}`
            );
          } catch (err) {
            console.warn("[post-watch] failed to enroll:", err);
          }
        }
      }
    } else {
      const executeError = result.error ?? "execute failed";
      console.error(`[execute] failed jobId=${result.jobId}: ${executeError}`);
      await this.options.store.updateStatus(draft.id, "failed", {
        payload: {
          status: "failed",
          executeError,
          executeJobId: result.jobId,
          executeDryRun: result.dryRun,
        },
      });
      throw new Error(executeError);
    }
  }

  /**
   * COMMUNITY_POST_MODE=manual: skip browser/oauth write; notify human to post.
   * Does not advance warmup / promo / cadence ledgers (no live post).
   * Idempotent: skips Telegram re-notify if this draft was already notified.
   */
  private async runManualPostNotify(
    ctx: AgentContext,
    draft: CommunityDraft
  ): Promise<void> {
    const jobId = executeJobId(draft);
    const preview = draftPreview(draft.draftText);
    const text = formatManualPostNotify(draft);

    let alreadyNotified = false;
    try {
      const prior = await this.options.store.get<{
        manualNotifiedAt?: string;
        executeTransport?: string;
      }>(draft.id);
      const payload = prior?.payload;
      alreadyNotified = Boolean(
        payload?.manualNotifiedAt || payload?.executeTransport === "manual"
      );
    } catch {
      /* ignore — still notify */
    }

    console.log(
      `[execute] manual mode — skip write jobId=${jobId} r/${draft.subreddit}` +
        (alreadyNotified ? " (notify idempotent skip)" : "")
    );

    if (!alreadyNotified) {
      try {
        await this.options.adapter?.notify?.(text);
      } catch (err) {
        console.warn("[execute] manual notify failed:", err);
      }
    }

    const result: ExecuteResult = {
      ok: true,
      dryRun: true,
      jobId,
      transport: "manual",
      log: text,
    };
    ctx.executeResult = result;
    const executeEvidence: ExecuteEvidence = {
      ok: true,
      dryRun: true,
      jobId,
      transport: "manual",
    };
    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      execute: executeEvidence,
    };

    // Keep approved/edited — do not mark posted (human has not posted yet).
    try {
      await this.options.store.updateStatus(draft.id, draft.status, {
        payload: {
          status: draft.status,
          postMode: "manual",
          executeJobId: jobId,
          executeTransport: "manual",
          ...(alreadyNotified
            ? {}
            : { manualNotifiedAt: new Date().toISOString() }),
          ...(preview ? { preview } : {}),
        },
      });
    } catch (err) {
      console.warn("[execute] manual store update:", err);
    }
  }

  private async runLearn(
    ctx: AgentContext,
    engine?: ExecutionEngine
  ): Promise<void> {
    const draft = ctx.currentDraft as CommunityDraft | undefined;
    const outcome = String(ctx.hitlOutcome ?? draft?.status ?? "unknown");
    console.log(`[learn] outcome=${outcome} draft=${draft?.id ?? "n/a"}`);

    let memory: MemoryWriteEvidence = { attempted: false };
    if (draft && (outcome === "approved" || outcome === "edited")) {
      memory = await this.writeHitlMemory(draft, outcome, engine);
    }

    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      learn: {
        outcome,
        draftId: draft?.id,
        memoryAvailable: this.options.memory.available,
        memory,
      },
    };
  }

  private async writeHitlMemory(
    draft: CommunityDraft,
    outcome: "aborted" | "approved" | "edited",
    engine?: ExecutionEngine
  ): Promise<MemoryWriteEvidence> {
    const domain = communityFactDomain("outcome");
    const eventId = `draft:${draft.id}:${outcome}`;
    const fact =
      outcome === "aborted"
        ? CommunityMemory.aborted("user aborted before post", {
            draftId: draft.id,
            subreddit: draft.subreddit,
            intensity: draft.intensity,
            threadUrl: draft.threadUrl,
            threadTitle: draft.threadTitle,
          })
        : CommunityMemory.approved({
            draftId: draft.id,
            intensity: draft.intensity,
            subreddit: draft.subreddit,
            threadUrl: draft.threadUrl,
            threadTitle: draft.threadTitle,
            note: outcome === "edited" ? "human edited draft before approve" : undefined,
          });

    let ok = false;
    let action: string | undefined;
    if (domain) {
      if (engine?.type === "data") {
        const result = await engine.execute({
          type: "add_event",
          params: {
            eventId,
            facets: [{ content: fact, domain }],
            source: `relay:${APP_ID}`,
          },
        });
        ok = result.success;
        const data = result.data as
          | { action?: string; results?: Array<{ action?: string }> }
          | undefined;
        action = data?.action ?? data?.results?.[0]?.action;
      } else {
        const written = await this.options.memory.addEvent(
          eventId,
          [{ content: fact, domain }],
          { source: `relay:${APP_ID}` }
        );
        ok = written.length > 0;
        action = written[0]?.action;
      }
    }
    console.log(
      `[learn] voltmem event ${ok ? "ok" : "skipped/fail-open"} (${outcome})` +
        ` event=${eventId}` +
        (action ? ` action=${action}` : "")
    );

    try {
      await getAllowlistStore().recordOutcome(draft.subreddit, outcome);
    } catch (err) {
      console.warn("[learn] allowlist outcome update failed:", err);
    }

    const evidence: MemoryWriteEvidence = {
      attempted: true,
      ok,
      domain,
      outcome,
      eventId,
      action,
    };
    const ctx = this.options.getContext();
    const priorHitl = (ctx.stageResults?.hitl as HitlEvidence | undefined) ?? {};
    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      hitl: priorHitl,
      learn: {
        ...((ctx.stageResults?.learn as object) ?? {}),
        outcome,
        draftId: draft.id,
        memoryAvailable: this.options.memory.available,
        memory: evidence,
      },
    };
    return evidence;
  }

  private markHitlWaitStart(ctx: AgentContext): void {
    if (ctx.hitlRequestedAt == null) {
      ctx.hitlRequestedAt = Date.now();
    }
  }

  private takeHitlWaitMs(ctx: AgentContext): number | undefined {
    const started = ctx.hitlRequestedAt;
    delete ctx.hitlRequestedAt;
    if (typeof started !== "number") return undefined;
    return Math.max(0, Date.now() - started);
  }

  private recordJobHitl(ctx: AgentContext, outcome: string): void {
    const draft = ctx.currentDraft as CommunityDraft | undefined;
    const hitl: HitlEvidence = {
      outcome,
      waitMs: this.takeHitlWaitMs(ctx),
      intensity2Confirmed:
        draft?.intensity === 2 &&
        (outcome === "approved" || outcome === "edited")
          ? true
          : undefined,
    };
    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      hitl,
    };
  }

  private patchDiscoverEvidence(
    ctx: AgentContext,
    patch: Partial<DiscoverEvidence>
  ): void {
    const prior = (ctx.stageResults?.discover as DiscoverEvidence | undefined) ?? {
      enabled: true,
      ran: true,
      candidateCount: 0,
      candidateNames: [],
    };
    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      discover: { ...prior, ...patch },
    };
  }

  private finishDiscoverHitlWait(feedback: FeedbackResponse): void {
    const ctx = this.options.getContext();
    const waitMs = this.takeHitlWaitMs(ctx);
    if (waitMs === undefined && !isAbortResponse(feedback)) return;
    this.patchDiscoverEvidence(ctx, {
      hitlWaitMs: waitMs,
    });
  }

  private finishScoutHitlWait(): void {
    const ctx = this.options.getContext();
    const waitMs = this.takeHitlWaitMs(ctx);
    if (waitMs === undefined) return;
    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      scout: {
        ...((ctx.stageResults?.scout as object) ?? {}),
        interstitialHitlWaitMs: waitMs,
      },
    };
  }
}
