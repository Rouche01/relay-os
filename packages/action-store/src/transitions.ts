import type { ActionStatus } from "./types.js";

/** Allowed next statuses from each lifecycle state. */
export const ACTION_TRANSITIONS: Record<ActionStatus, readonly ActionStatus[]> = {
  proposed: ["pending_approval", "aborted", "failed"],
  pending_approval: ["approved", "edited", "aborted", "failed"],
  approved: ["posted", "failed", "aborted"],
  edited: ["posted", "failed", "aborted"],
  aborted: [],
  posted: [],
  failed: ["pending_approval", "proposed"],
};

export function canTransition(from: ActionStatus, to: ActionStatus): boolean {
  if (from === to) return true;
  return ACTION_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ActionStatus, to: ActionStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid action status transition: ${from} → ${to}`);
  }
}

/** Statuses that may proceed to execute / write side-effects. */
export function isExecutableStatus(status: ActionStatus): boolean {
  return status === "approved" || status === "edited";
}

/** Terminal statuses (no further HITL). */
export function isTerminalStatus(status: ActionStatus): boolean {
  return status === "aborted" || status === "posted";
}
