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
import {
  DISCOVER_SKIP_OPTION,
  discoveryChoiceOptions,
  parseDiscoveryChoice,
  runDiscovery,
} from "./discover.js";
import { executeApproved } from "./executor.js";
import { getAllowlistStore } from "./allowlist-store.js";
import { CommunityMemory } from "./memory.js";
import { loginRedditBrowser } from "./reddit/browser-login.js";
import { createRedditBrowserEngine } from "./reddit/browser-session.js";
import { getRedditEnv, type RedditEnvConfig } from "./reddit/config.js";
import type { DiscoveryCandidate } from "./reddit/discover-subs.js";
import {
  isLoginCredentialPoint,
  isOtpCredentialPoint,
  parseCredentialValue,
} from "./reddit/credentials.js";
import { hasStorageState, storageStatePath } from "./reddit/cookies.js";
import { detectInterstitial } from "./reddit/interstitial.js";
import {
  clearInterstitialSession,
  setInterstitialSession,
} from "./reddit/interstitial-session.js";
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
 * Stage logic: ensure_session → discover → scout → draft → HITL → execute → learn.
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
      return this.applyDiscoverFeedback(feedback);
    }

    if (stage.name === "scout") {
      return this.applyInterstitialFeedback(feedback);
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
    if (stage.name === "discover" && fp.type === "choice") {
      const candidates = (context.discoveryCandidates ?? []) as DiscoveryCandidate[];
      return {
        title: "Promote a discovered subreddit?",
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
              "Reply with an option (e.g. r/fashionadvice) to promote, or none (skip). Abort also skips.",
          },
        ],
        meta: { kind: "discover" },
      };
    }
    if (stage.name === "scout" && fp.type === "confirmation") {
      const challenge = context.interstitialChallenge as
        | { url?: string; subreddit?: string; blockedSubs?: string[] }
        | undefined;
      return {
        title: "Reddit anti-bot challenge",
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
              "Solve the CAPTCHA in the open browser window, then Approve. Abort skips without saving cookies (run continues).",
          },
        ],
        meta: { kind: "interstitial" },
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
    if (stage.name === "discover" && fp.type === "choice") {
      const candidates = (context.discoveryCandidates ?? []) as DiscoveryCandidate[];
      return candidates.length === 0;
    }
    if (stage.name === "scout" && fp.type === "confirmation") {
      // Only pause when we opened a headed challenge window.
      return !context.interstitialChallenge;
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
    if (stage.name === "discover" && fp.type === "choice") {
      const candidates = (context.discoveryCandidates ?? []) as DiscoveryCandidate[];
      return (
        `Found ${candidates.length} candidate subreddit(s). ` +
        `Promote one onto the allowlist (so future scouts can draft there), ` +
        `or choose "${DISCOVER_SKIP_OPTION}". Nothing is postable until you promote.`
      );
    }
    if (stage.name === "scout" && fp.type === "confirmation") {
      const challenge = context.interstitialChallenge as
        | { subreddit?: string; url?: string }
        | undefined;
      return (
        `Reddit challenged the browser (r/${challenge?.subreddit ?? "?"}). ` +
        `A headed window is open on the challenge page — solve the CAPTCHA there, then Approve. ` +
        `Abort skips saving cookies; the run continues with whatever we already scouted. ` +
        `We never auto-solve CAPTCHAs.`
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

  async buildFeedbackOptions(
    stage: StageDefinition,
    fp: FeedbackPoint,
    context: AgentContext
  ): Promise<string[] | undefined> {
    if (stage.name === "discover" && fp.type === "choice") {
      const candidates = (context.discoveryCandidates ?? []) as DiscoveryCandidate[];
      return discoveryChoiceOptions(candidates);
    }
    return undefined;
  }

  private async runDiscover(ctx: AgentContext): Promise<void> {
    const result = await runDiscovery({
      memory: this.options.memory,
      store: getAllowlistStore(),
    });
    ctx.discoveryCandidates = result.candidates;
    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      discover: {
        enabled: result.enabled,
        count: result.candidates.length,
        names: result.candidates.map((c) => c.name),
        skippedReason: result.skippedReason,
      },
    };
  }

  private async applyDiscoverFeedback(
    feedback: FeedbackResponse
  ): Promise<boolean> {
    // Soft-abort: skip promotion and continue to scout.
    if (isAbortResponse(feedback)) {
      console.log("[discover] aborted — no allowlist promotion");
      return false;
    }

    const parsed = parseDiscoveryChoice(feedback.value);
    if (parsed.action === "skip") {
      console.log("[discover] skipped promotion");
      return true;
    }

    const store = getAllowlistStore();
    const promoted = await store.promote(parsed.name);
    if (!promoted) {
      console.warn(`[discover] promote failed for r/${parsed.name}`);
      return true;
    }

    await this.options.memory.addFact(
      CommunityMemory.allowlistPromoted(promoted.name, promoted.note),
      { domain: "preference", source: `relay:${APP_ID}` }
    );
    await this.options.memory.addFact(
      CommunityMemory.subredditRules(promoted.name, promoted.note),
      { domain: "preference", source: `relay:${APP_ID}` }
    );
    console.log(
      `[discover] promoted r/${promoted.name} → postable allowlist`
    );
    return true;
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
    const cfg = getRedditEnv();
    const store = getAllowlistStore();
    // When discover just ran with a max-subs cap, leave room for exploration.
    const subreddits = await store.pickScoutSubs(
      cfg.scoutMaxSubs,
      cfg.discoverExploreSlot
    );
    console.log(
      `[scout] allowlist (${subreddits.length}): ${subreddits
        .map((s) => `r/${s}`)
        .join(", ")}`
    );

    const result = await scoutOpportunities({ limit: 5, subreddits });
    let opportunities = result.drafts;

    // Don't re-queue threads we already drafted / decided on this machine.
    const prior = await this.options.store.list({
      appId: APP_ID,
      limit: 500,
    });
    const seen = new Set(prior.map((r) => r.id));
    const before = opportunities.length;
    opportunities = opportunities.filter((d) => !seen.has(d.id));
    if (before !== opportunities.length) {
      console.log(
        `[scout] skipped ${before - opportunities.length} already-seen draft(s) in action-store`
      );
    }

    console.log(
      `[scout] ${opportunities.length} actionable (score ≥ 4) via ${result.source}`
    );
    for (const d of opportunities) {
      console.log(
        `  - [${scoreTotal(d.score)}/5] r/${d.subreddit} · ${d.threadTitle}`
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
        skippedSeen: before - opportunities.length,
      },
    };

    await this.maybeEscalateInterstitial(ctx, result.blocked);
  }

  /**
   * If browser scout hit an anti-bot wall and HITL is enabled, open a headed
   * window on the challenge and set interstitialChallenge so the scout
   * confirmation feedback point pauses for Telegram/CLI Approve.
   */
  private async maybeEscalateInterstitial(
    ctx: AgentContext,
    blocked: Array<{ subreddit: string; url: string; reason: string }>
  ): Promise<void> {
    const cfg = getRedditEnv();
    if (blocked.length === 0) return;

    // Rate-limit pages need cool-down, not a CAPTCHA solve in a headed window.
    const captchaBlocked = blocked.filter((b) => b.reason !== "rate_limit");
    const rateLimited = blocked.filter((b) => b.reason === "rate_limit");
    if (rateLimited.length > 0) {
      console.warn(
        `[scout] rate-limited on ${rateLimited.map((b) => `r/${b.subreddit}`).join(", ")} — ` +
          `wait several minutes; raise REDDIT_SCOUT_DELAY_MS / lower REDDIT_SCOUT_MAX_SUBS`
      );
    }
    if (captchaBlocked.length === 0) return;

    if (!cfg.interstitialHitl) {
      console.warn(
        `[scout] ${captchaBlocked.length} sub(s) blocked by interstitial — unattended mode ` +
          `(set REDDIT_INTERSTITIAL_HITL=true or run headed to escalate via Telegram/CLI)`
      );
      return;
    }

    const first = captchaBlocked[0]!;
    console.log(
      `[scout] escalating interstitial for r/${first.subreddit} — opening headed browser`
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
        // Challenge already cleared (jar / race) — persist and continue.
        await engine.saveStorageState(storagePath);
        await engine.teardown();
        console.log(
          `[scout] challenge page cleared without HITL — saved jar → ${storagePath}`
        );
        return;
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
    ctx.interstitialChallenge = {
      url: first.url,
      subreddit: first.subreddit,
      blockedSubs: captchaBlocked.map((b) => b.subreddit),
      storagePath: storageStatePath(cfg),
    };
  }

  /**
   * Approve → save cookie jar after human solved CAPTCHA in the headed window.
   * Abort → soft-abort (return false): tear down without saving; run continues.
   */
  private async applyInterstitialFeedback(
    feedback: FeedbackResponse
  ): Promise<boolean | void> {
    const ctx = this.options.getContext();

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

    const saved = await clearInterstitialSession(true);
    delete ctx.interstitialChallenge;
    ctx.stageResults = {
      ...(ctx.stageResults ?? {}),
      scout: {
        ...((ctx.stageResults?.scout as object) ?? {}),
        interstitial: saved ? "cleared" : "save_failed",
        storagePath: saved,
      },
    };
    console.log(
      "[scout] interstitial HITL approved — jar saved; later stages reuse cookies"
    );
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

    try {
      await getAllowlistStore().recordOutcome(draft.subreddit, outcome);
    } catch (err) {
      console.warn("[learn] allowlist outcome update failed:", err);
    }
  }
}
