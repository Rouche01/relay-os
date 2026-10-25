import path from "node:path";
import { ComputerTaskRunner } from "@relay/engines-computer";
import type { DecisionPort } from "@relay/engines-decide";
import type {
  PageClass,
  PageClassDecision,
} from "../../decide/interstitial-decide.js";
import {
  classifyComputerFrame,
  isComputerPageClear,
  isComputerRateLimited,
} from "./computer-frame-classify.js";
import {
  clearComputerChallengeSession,
  getComputerChallengeSession,
  setComputerChallengeSession,
  type ComputerChallengeSession,
} from "./computer-challenge-session.js";
import type { ComputerRunSession } from "./computer-run-session.js";

export type ComputerChallengeReason = "login" | "interstitial";

/** Streaming-UI-ready feedback meta (CLI/Telegram today). */
export interface ComputerChallengeFeedbackMeta {
  kind: "login" | "interstitial";
  vncUrl?: string;
  evidencePath?: string;
  engageJobId: string;
  sessionId?: string;
  pageClass: PageClass;
  transport: "computer";
}

export interface ComputerChallengeHitlContext {
  meta: ComputerChallengeFeedbackMeta;
  decision: PageClassDecision;
  vncUrl?: string;
  evidencePaths: string[];
  /** Description text for a confirmation FeedbackPoint. */
  description: string;
}

export interface PrepareComputerChallengeOptions {
  runSession: ComputerRunSession;
  evidenceDir: string;
  reason: ComputerChallengeReason;
  /** Open this URL before capture; omit to classify the current desktop. */
  url?: string;
  settleMs?: number;
  decide?: DecisionPort;
  runner?: ComputerTaskRunner;
  /** Test override for the initial classify. */
  forcePageClass?: PageClass;
  notify?: (message: string) => Promise<void>;
  fileStem?: string;
}

export type PrepareComputerChallengeResult =
  | {
      status: "clear";
      decision: PageClassDecision;
      vncUrl?: string;
      evidencePaths: string[];
    }
  | {
      status: "rate_limit";
      decision: PageClassDecision;
      vncUrl?: string;
      evidencePaths: string[];
    }
  | {
      status: "wall";
      hitl: ComputerChallengeHitlContext;
      decision: PageClassDecision;
      vncUrl?: string;
      evidencePaths: string[];
    }
  | {
      status: "error";
      error: string;
      vncUrl?: string;
      evidencePaths?: string[];
    };

export interface RunComputerChallengeGateOptions
  extends PrepareComputerChallengeOptions {
  /**
   * Called after park when a wall is detected. Resolve `"proceed"` | `"abort"`.
   * Raced against screenshot poll (Approve wins or poll clear).
   * If omitted, only polls until clear / maxWaitMs.
   */
  waitForHuman?: (
    ctx: ComputerChallengeHitlContext
  ) => Promise<"proceed" | "abort">;
  pollMs?: number;
  maxWaitMs?: number;
  /**
   * Test hook for poll recheck classify (same as session.forceRecheckPageClass).
   */
  forceRecheckPageClass?: () => PageClass | undefined;
}

export type RunComputerChallengeGateResult =
  | {
      ok: true;
      pageClass: PageClass;
      vncUrl?: string;
      evidencePaths: string[];
      clearedBy: "already_clear" | "poll" | "human";
    }
  | {
      ok: false;
      error: string;
      aborted?: boolean;
      rateLimited?: boolean;
      vncUrl?: string;
      pageClass?: PageClass;
      evidencePaths?: string[];
    };

/**
 * Open (optional) → capture → classify. On wall: soft-park, register challenge
 * session for FeedbackBroker auto-resolve, return HITL context (never solve).
 */
export async function prepareComputerChallenge(
  opts: PrepareComputerChallengeOptions
): Promise<PrepareComputerChallengeResult> {
  const { runSession, evidenceDir, reason } = opts;
  const settleMs = opts.settleMs ?? 2000;
  const stem =
    opts.fileStem?.replace(/[^\w.-]+/g, "_") ||
    `challenge-${reason}-${Date.now()}`;

  const lease = await runSession.ensureLeased();
  if (!lease.ok) {
    return {
      status: "error",
      error: lease.error ?? "computer lease failed",
      vncUrl: lease.vncUrl ?? runSession.vncUrl,
    };
  }

  const runner =
    opts.runner ??
    new ComputerTaskRunner({
      engine: runSession.engine,
      evidenceDir,
      agentId: "community-engager",
    });

  const evidencePaths: string[] = [];
  let vncUrl = lease.vncUrl ?? runSession.vncUrl;

  if (opts.url?.trim()) {
    const opened = await runner.run(
      "open_url",
      { url: opts.url.trim(), settleMs },
      {
        jobId: runSession.jobId,
        evidenceDir,
        holdSession: true,
        reuseSession: true,
      }
    );
    if (!opened.success) {
      await runSession.park();
      return {
        status: "error",
        error: opened.error ?? "open_url failed",
        vncUrl: opened.vncUrl ?? vncUrl,
        evidencePaths: opened.evidencePaths,
      };
    }
    vncUrl = opened.vncUrl ?? vncUrl;
    if (opened.evidencePaths) evidencePaths.push(...opened.evidencePaths);
  }

  const captured = await runner.run(
    "capture_frame",
    {
      evidenceDir,
      fileStem: stem,
      meta: {
        kind: reason,
        note: "computer challenge frame — CAPTCHA/login never auto-solved",
      },
    },
    {
      jobId: runSession.jobId,
      evidenceDir,
      reuseSession: true,
      holdSession: true,
    }
  );
  if (!captured.success) {
    await runSession.park();
    return {
      status: "error",
      error: captured.error ?? "capture_frame failed",
      vncUrl: captured.vncUrl ?? vncUrl,
      evidencePaths: captured.evidencePaths ?? evidencePaths,
    };
  }
  vncUrl = captured.vncUrl ?? vncUrl;
  if (captured.evidencePaths) evidencePaths.push(...captured.evidencePaths);

  const pngPath =
    captured.evidencePaths?.find((p) => p.endsWith(".png")) ??
    path.join(evidenceDir, `${stem}.png`);

  const decision = await classifyComputerFrame({
    evidencePath: pngPath,
    vncUrl,
    reason,
    phase: "assume_wall",
    decide: opts.decide,
    forcePageClass: opts.forcePageClass,
  });

  if (isComputerPageClear(decision)) {
    return { status: "clear", decision, vncUrl, evidencePaths };
  }

  if (isComputerRateLimited(decision)) {
    await runSession.park();
    return { status: "rate_limit", decision, vncUrl, evidencePaths };
  }

  const parked = await runSession.park();
  if (!parked.ok) {
    console.warn(
      `[computer:challenge] park failed: ${parked.error ?? "unknown"}`
    );
  }

  const hitl = buildHitlContext({
    runSession,
    reason,
    decision,
    vncUrl: runSession.vncUrl ?? vncUrl,
    evidencePath: pngPath,
    evidencePaths,
  });

  setComputerChallengeSession({
    runSession,
    evidenceDir,
    reason,
    settleMs,
    decide: opts.decide,
    vncUrl: hitl.vncUrl,
    evidencePath: pngPath,
  });

  if (opts.notify) {
    try {
      await opts.notify(
        `${hitl.description}\n` +
          (hitl.vncUrl ? `${hitl.vncUrl}\n` : "") +
          `We auto-continue when clear (or Approve). Never auto-solves CAPTCHAs.`
      );
    } catch (err) {
      console.warn("[computer:challenge] notify failed:", err);
    }
  }

  if (hitl.vncUrl) {
    console.log("[computer:challenge] Live desktop — solve in VNC:");
    console.log(hitl.vncUrl);
  }

  return { status: "wall", hitl, decision, vncUrl: hitl.vncUrl, evidencePaths };
}

/**
 * Full gate: prepare → if wall, race human Approve vs poll clear → leave leased on success.
 */
export async function runComputerChallengeGate(
  opts: RunComputerChallengeGateOptions
): Promise<RunComputerChallengeGateResult> {
  const prepared = await prepareComputerChallenge(opts);
  if (prepared.status === "error") {
    return {
      ok: false,
      error: prepared.error,
      vncUrl: prepared.vncUrl,
      evidencePaths: prepared.evidencePaths,
    };
  }
  if (prepared.status === "clear") {
    return {
      ok: true,
      pageClass: prepared.decision.pageClass,
      vncUrl: prepared.vncUrl,
      evidencePaths: prepared.evidencePaths,
      clearedBy: "already_clear",
    };
  }
  if (prepared.status === "rate_limit") {
    return {
      ok: false,
      error: "rate_limit",
      rateLimited: true,
      pageClass: prepared.decision.pageClass,
      vncUrl: prepared.vncUrl,
      evidencePaths: prepared.evidencePaths,
    };
  }

  const session = ensureChallengeSession(opts);
  if (opts.forceRecheckPageClass) {
    session.forceRecheckPageClass = opts.forceRecheckPageClass;
  }
  if (opts.pollMs != null) session.pollMs = opts.pollMs;

  const pollMs = resolvePollMs(opts.pollMs ?? session.pollMs);
  const maxWaitMs = opts.maxWaitMs ?? 30 * 60 * 1000;

  const humanPromise = opts.waitForHuman
    ? opts.waitForHuman(prepared.hitl)
    : null;

  const pollPromise = pollUntilClear({
    session,
    pollMs,
    maxWaitMs,
    decide: opts.decide,
  });

  let outcome: "proceed" | "abort" | "poll_clear" | "timeout";
  if (humanPromise) {
    const raced = await Promise.race([
      humanPromise.then((a) =>
        a === "abort"
          ? ({ t: "abort" } as const)
          : ({ t: "proceed" } as const)
      ),
      pollPromise.then((p) =>
        p === "clear"
          ? ({ t: "poll_clear" } as const)
          : ({ t: "timeout" } as const)
      ),
    ]);
    outcome = raced.t;
  } else {
    const p = await pollPromise;
    outcome = p === "clear" ? "poll_clear" : "timeout";
  }

  clearComputerChallengeSession();

  if (outcome === "abort") {
    return {
      ok: false,
      error: "aborted",
      aborted: true,
      vncUrl: prepared.vncUrl,
      evidencePaths: prepared.evidencePaths,
      pageClass: prepared.decision.pageClass,
    };
  }

  if (outcome === "timeout") {
    return {
      ok: false,
      error: "challenge wait timed out",
      vncUrl: prepared.vncUrl,
      evidencePaths: prepared.evidencePaths,
      pageClass: prepared.decision.pageClass,
    };
  }

  const lease = await opts.runSession.ensureLeased();
  if (!lease.ok) {
    return {
      ok: false,
      error: lease.error ?? "reattach after challenge failed",
      vncUrl: prepared.vncUrl,
      evidencePaths: prepared.evidencePaths,
    };
  }

  return {
    ok: true,
    pageClass: "feed",
    vncUrl: lease.vncUrl ?? prepared.vncUrl,
    evidencePaths: prepared.evidencePaths,
    clearedBy: outcome === "poll_clear" ? "poll" : "human",
  };
}

export function buildComputerChallengeFeedbackMeta(input: {
  runSession: ComputerRunSession;
  reason: ComputerChallengeReason;
  decision: PageClassDecision;
  vncUrl?: string;
  evidencePath?: string;
}): ComputerChallengeFeedbackMeta {
  return {
    kind: input.reason,
    vncUrl: input.vncUrl ?? input.runSession.vncUrl,
    evidencePath: input.evidencePath,
    engageJobId: input.runSession.jobId,
    sessionId:
      input.runSession.sessionId ??
      input.runSession.engine.getParkedSessionId() ??
      undefined,
    pageClass: input.decision.pageClass,
    transport: "computer",
  };
}

export function formatComputerChallengeDescription(
  reason: ComputerChallengeReason,
  vncUrl?: string
): string {
  const what =
    reason === "login"
      ? "Finish Reddit login (2FA / CAPTCHA) on the live desktop"
      : "Solve the CAPTCHA / humanity check on the live desktop";
  const link = vncUrl ? `\n\nOpen VNC:\n${vncUrl}` : "";
  return (
    `${what}. We auto-continue when it clears (or Approve). Abort skips.` +
    ` We never auto-solve CAPTCHAs.` +
    link
  );
}

/** Capture + classify recheck for an active parked challenge (broker poll). */
export async function pollComputerChallengeOnce(
  session: ComputerChallengeSession
): Promise<{ clear: boolean; decision: PageClassDecision; evidencePath?: string }> {
  const lease = await session.runSession.ensureLeased();
  if (!lease.ok) {
    return {
      clear: false,
      decision: {
        pageClass: "unknown",
        detection: { challenged: true, reason: "unknown" },
        confidence: 0,
        escalateHitl: true,
        backend: "lease",
        rationale: lease.error,
      },
    };
  }

  const runner = new ComputerTaskRunner({
    engine: session.runSession.engine,
    evidenceDir: session.evidenceDir,
    agentId: "community-engager",
  });
  const stem = `challenge-poll-${Date.now()}`;
  const captured = await runner.run(
    "capture_frame",
    {
      evidenceDir: session.evidenceDir,
      fileStem: stem,
      meta: { kind: session.reason, phase: "recheck" },
    },
    {
      jobId: session.runSession.jobId,
      evidenceDir: session.evidenceDir,
      reuseSession: true,
      holdSession: true,
    }
  );

  // Soft-park again so HITL keeps a warm desktop between polls.
  await session.runSession.park();

  if (!captured.success) {
    return {
      clear: false,
      decision: {
        pageClass: "unknown",
        detection: { challenged: true, reason: "unknown" },
        confidence: 0,
        escalateHitl: true,
        backend: "capture",
        rationale: captured.error,
      },
    };
  }

  const pngPath =
    captured.evidencePaths?.find((p) => p.endsWith(".png")) ??
    path.join(session.evidenceDir, `${stem}.png`);
  session.evidencePath = pngPath;
  session.vncUrl =
    captured.vncUrl ?? session.runSession.vncUrl ?? session.vncUrl;

  const forced = session.forceRecheckPageClass?.();
  const decision = await classifyComputerFrame({
    evidencePath: pngPath,
    vncUrl: session.vncUrl,
    reason: session.reason,
    phase: "recheck",
    decide: session.decide,
    forcePageClass: forced,
  });

  return {
    clear: isComputerPageClear(decision),
    decision,
    evidencePath: pngPath,
  };
}

function buildHitlContext(input: {
  runSession: ComputerRunSession;
  reason: ComputerChallengeReason;
  decision: PageClassDecision;
  vncUrl?: string;
  evidencePath: string;
  evidencePaths: string[];
}): ComputerChallengeHitlContext {
  const meta = buildComputerChallengeFeedbackMeta({
    runSession: input.runSession,
    reason: input.reason,
    decision: input.decision,
    vncUrl: input.vncUrl,
    evidencePath: input.evidencePath,
  });
  return {
    meta,
    decision: input.decision,
    vncUrl: meta.vncUrl,
    evidencePaths: input.evidencePaths,
    description: formatComputerChallengeDescription(
      input.reason,
      meta.vncUrl
    ),
  };
}

function ensureChallengeSession(
  opts: RunComputerChallengeGateOptions
): ComputerChallengeSession {
  const existing = getComputerChallengeSession();
  if (existing) {
    if (opts.forceRecheckPageClass) {
      existing.forceRecheckPageClass = opts.forceRecheckPageClass;
    }
    return existing;
  }
  const created: ComputerChallengeSession = {
    runSession: opts.runSession,
    evidenceDir: opts.evidenceDir,
    reason: opts.reason,
    settleMs: opts.settleMs,
    pollMs: opts.pollMs,
    decide: opts.decide,
    forceRecheckPageClass: opts.forceRecheckPageClass,
  };
  setComputerChallengeSession(created);
  return created;
}

async function pollUntilClear(opts: {
  session: ComputerChallengeSession;
  pollMs: number;
  maxWaitMs: number;
  decide?: DecisionPort;
}): Promise<"clear" | "timeout"> {
  const deadline = Date.now() + opts.maxWaitMs;
  // Brief pause so the human can start before first recheck.
  await sleep(Math.min(opts.pollMs, 2500));
  while (Date.now() < deadline) {
    if (opts.decide) opts.session.decide = opts.decide;
    const once = await pollComputerChallengeOnce(opts.session);
    if (once.clear) {
      console.log(
        "[computer:challenge] auto-detected clear on desktop — proceeding"
      );
      return "clear";
    }
    await sleep(opts.pollMs);
  }
  return "timeout";
}

function resolvePollMs(raw?: number): number {
  const fromEnv = Number(process.env.REDDIT_INTERSTITIAL_POLL_MS ?? "");
  const n = raw ?? (Number.isFinite(fromEnv) ? fromEnv : 2000);
  return Number.isFinite(n) && n >= 500 ? n : 2000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
