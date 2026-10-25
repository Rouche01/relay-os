import type { ComputerEngine } from "../computer-engine.js";

/** Lease / evidence bag passed into every ComputerTask. */
export interface ComputerTaskSession {
  jobId?: string;
  agentId?: string;
  /** Directory for PNG / JSON evidence (created by capture tasks as needed). */
  evidenceDir: string;
}

export interface ComputerTaskContext {
  engine: ComputerEngine;
  session: ComputerTaskSession;
  params: Record<string, unknown>;
}

export interface ComputerTaskResult {
  success: boolean;
  error?: string;
  evidencePaths?: string[];
  meta?: Record<string, unknown>;
  vncUrl?: string;
}

/**
 * Named desktop procedure composed from ComputerEngine primitives.
 * Register custom tasks on ComputerTaskRunner for scout / preview / execute recipes.
 */
export interface ComputerTask {
  id: string;
  run(ctx: ComputerTaskContext): Promise<ComputerTaskResult>;
}

export interface ComputerTaskRunOptions {
  /** Override session job id for this run (lease + evidence naming). */
  jobId?: string;
  agentId?: string;
  evidenceDir?: string;
  /** Keep lease after the task finishes (caller must release). Default false. */
  holdSession?: boolean;
  /** Skip lease if already leased; still release unless holdSession. Default false. */
  reuseSession?: boolean;
  ttlSec?: number;
}
