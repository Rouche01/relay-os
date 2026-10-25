import type { DecisionPort } from "@relay/engines-decide";
import type { PageClass } from "../../decide/interstitial-decide.js";
import type { ComputerRunSession } from "./computer-run-session.js";

/**
 * Live computer challenge for FeedbackBroker auto-resolve (same role as
 * headed interstitial session, but VNC desktop).
 */
export interface ComputerChallengeSession {
  runSession: ComputerRunSession;
  evidenceDir: string;
  reason: "login" | "interstitial";
  settleMs?: number;
  pollMs?: number;
  decide?: DecisionPort;
  /** Test hook — force classify outcome on each poll recheck. */
  forceRecheckPageClass?: () => PageClass | undefined;
  vncUrl?: string;
  evidencePath?: string;
}

let active: ComputerChallengeSession | undefined;

export function setComputerChallengeSession(
  session: ComputerChallengeSession
): void {
  active = session;
}

export function getComputerChallengeSession():
  | ComputerChallengeSession
  | undefined {
  return active;
}

export function clearComputerChallengeSession(): void {
  active = undefined;
}
