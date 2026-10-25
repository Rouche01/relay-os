import type { ComputerEngine } from "../computer-engine.js";
import { builtinComputerTasks } from "./builtins.js";
import type {
  ComputerTask,
  ComputerTaskResult,
  ComputerTaskRunOptions,
  ComputerTaskSession,
} from "./types.js";

export interface ComputerTaskRunnerOptions {
  engine: ComputerEngine;
  /** Default evidence directory when run() omits evidenceDir. */
  evidenceDir?: string;
  /** Default agent_id on lease. */
  agentId?: string;
  /** When true (default), register open_url / capture_frame / tour_urls. */
  registerBuiltins?: boolean;
}

/**
 * Lease → run a named ComputerTask → release.
 * Apps register domain tasks (preview, scout_listing, …) beside builtins.
 */
export class ComputerTaskRunner {
  private readonly engine: ComputerEngine;
  private readonly tasks = new Map<string, ComputerTask>();
  private readonly defaultEvidenceDir: string;
  private readonly defaultAgentId?: string;

  constructor(options: ComputerTaskRunnerOptions) {
    this.engine = options.engine;
    this.defaultEvidenceDir = options.evidenceDir?.trim() || ".";
    this.defaultAgentId = options.agentId;
    if (options.registerBuiltins !== false) {
      for (const task of builtinComputerTasks) {
        this.register(task);
      }
    }
  }

  register(task: ComputerTask): void {
    if (!task.id?.trim()) {
      throw new Error("ComputerTask.id is required");
    }
    this.tasks.set(task.id, task);
  }

  getTask(id: string): ComputerTask | undefined {
    return this.tasks.get(id);
  }

  listTasks(): string[] {
    return [...this.tasks.keys()].sort();
  }

  /**
   * Run a registered task. By default leases a fresh session and releases after.
   * Set reuseSession / holdSession to share a lease across multiple runs.
   */
  async run(
    taskId: string,
    params: Record<string, unknown> = {},
    opts: ComputerTaskRunOptions = {}
  ): Promise<ComputerTaskResult> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return {
        success: false,
        error: `unknown computer task: ${taskId} (known: ${this.listTasks().join(", ") || "none"})`,
      };
    }

    const session: ComputerTaskSession = {
      jobId: opts.jobId,
      agentId: opts.agentId ?? this.defaultAgentId,
      evidenceDir: opts.evidenceDir?.trim() || this.defaultEvidenceDir,
    };

    const hadSession = Boolean(this.engine.getSessionId());
    let leasedThisRun = false;

    if (hadSession && !opts.reuseSession) {
      return {
        success: false,
        error:
          "engine already leased; pass reuseSession: true or release first",
      };
    }

    if (!hadSession) {
      const lease = await this.engine.execute({
        type: "lease",
        params: {
          job_id: session.jobId,
          agent_id: session.agentId,
          ttl_sec: opts.ttlSec,
        },
      });
      if (!lease.success) {
        return {
          success: false,
          error: lease.error ?? "computer lease failed",
        };
      }
      leasedThisRun = true;
    }

    const vncUrl = this.engine.getVncUrl() ?? undefined;

    try {
      const result = await task.run({
        engine: this.engine,
        session,
        params,
      });
      return {
        ...result,
        vncUrl: result.vncUrl ?? vncUrl,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, vncUrl };
    } finally {
      // Release unless caller holds the session for another run.
      if (!opts.holdSession && (leasedThisRun || opts.reuseSession)) {
        try {
          await this.engine.execute({ type: "release", params: {} });
        } catch {
          /* best-effort */
        }
      }
    }
  }
}
