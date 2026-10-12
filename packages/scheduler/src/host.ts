import { Cron } from "croner";
import {
  assertSchedulesValid,
  listEnabledSchedules,
  type AgenticAppManifest,
  type ScheduleDefinition,
} from "@relay/protocol";
import {
  emptyEvidence,
  readScheduleEvidence,
  writeScheduleEvidence,
  type ScheduleEvidence,
  type ScheduleRunStatus,
} from "./evidence.js";
import { tryAcquireLease } from "./lease.js";

export interface ScheduleInvokeContext {
  schedule: ScheduleDefinition;
  attemptedAt: string;
}

export type ScheduleInvoker = (
  entrypoint: string,
  ctx: ScheduleInvokeContext
) => void | Promise<void>;

export interface SchedulerLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface SchedulerHostOptions {
  /** Durable dir for locks + evidence (`{dataDir}/schedules/…`). */
  dataDir: string;
  /** Enabled schedules to arm. Prefer {@link SchedulerHost.fromManifest}. */
  schedules: ScheduleDefinition[];
  /** Invoked for each fire (after lease). */
  invoke: ScheduleInvoker;
  timezone?: string;
  /** Lease stale threshold (ms). */
  staleMs?: number;
  /**
   * When true, `every_ms` schedules fire once shortly after start then on interval.
   * Default false — first fire is one interval after start (missed-tick skip).
   */
  runOnStart?: boolean;
  onEvidence?: (evidence: ScheduleEvidence) => void;
  logger?: SchedulerLogger;
}

export interface ScheduleStatus {
  schedule: ScheduleDefinition;
  evidence: ScheduleEvidence;
  nextRunAt: string | null;
  running: boolean;
  /** True when {@link SchedulerHost.pause} was called; cron ticks and trigger are blocked. */
  paused: boolean;
}

interface ArmedJob {
  schedule: ScheduleDefinition;
  job: Cron;
  running: boolean;
  paused: boolean;
}

const defaultLogger: SchedulerLogger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

/**
 * Thin clock host: croner + file leases. Does not interpret app domain logic —
 * only invokes entrypoints. Missed-tick policy v1: **skip** (no catch-up backlog).
 */
export class SchedulerHost {
  private readonly opts: SchedulerHostOptions;
  private readonly log: SchedulerLogger;
  private readonly armed = new Map<string, ArmedJob>();
  private readonly evidenceCache = new Map<string, ScheduleEvidence>();
  private started = false;

  constructor(options: SchedulerHostOptions) {
    this.opts = options;
    this.log = options.logger ?? defaultLogger;
  }

  static fromManifest(
    manifest: AgenticAppManifest,
    options: Omit<SchedulerHostOptions, "schedules">
  ): SchedulerHost {
    assertSchedulesValid(manifest);
    return new SchedulerHost({
      ...options,
      schedules: listEnabledSchedules(manifest),
    });
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error("SchedulerHost already started");
    }
    this.started = true;

    for (const schedule of this.opts.schedules) {
      await this.arm(schedule);
    }

    if (this.armed.size === 0) {
      this.log.warn("[scheduler] no enabled schedules to arm");
    } else {
      this.log.info(
        `[scheduler] armed ${this.armed.size} schedule(s): ${[...this.armed.keys()].join(", ")}`
      );
    }
  }

  stop(): void {
    for (const armed of this.armed.values()) {
      armed.job.stop();
    }
    this.armed.clear();
    this.started = false;
    this.log.info("[scheduler] stopped");
  }

  getEvidence(scheduleId: string): ScheduleEvidence | undefined {
    return this.evidenceCache.get(scheduleId);
  }

  /** Whether {@link start} has been called and {@link stop} has not. */
  isStarted(): boolean {
    return this.started;
  }

  /** Whether the schedule is currently armed (may still be paused). */
  isArmed(scheduleId: string): boolean {
    return this.armed.has(scheduleId);
  }

  /** Whether an armed schedule is paused (no ticks / trigger until resume). */
  isPaused(scheduleId: string): boolean {
    return this.armed.get(scheduleId)?.paused === true;
  }

  listStatus(): ScheduleStatus[] {
    return [...this.armed.values()].map((armed) => {
      const evidence =
        this.evidenceCache.get(armed.schedule.id) ??
        emptyEvidence(armed.schedule.id, armed.schedule.entrypoint);
      const next = armed.paused ? null : armed.job.nextRun();
      return {
        schedule: armed.schedule,
        evidence,
        nextRunAt: next ? next.toISOString() : null,
        running: armed.running,
        paused: armed.paused,
      };
    });
  }

  /**
   * Pause an armed schedule: croner stops ticking; {@link trigger} rejects until resume.
   * Does not remove the schedule from the armed set ({@link isArmed} stays true).
   */
  pause(scheduleId: string): void {
    const armed = this.requireArmed(scheduleId);
    if (armed.paused) return;
    armed.job.pause();
    armed.paused = true;
    this.log.info(`[scheduler] ${scheduleId} paused`);
    void this.record(armed.schedule, { nextRunAt: null });
  }

  /** Resume a paused schedule (no-op if already running). */
  resume(scheduleId: string): void {
    const armed = this.requireArmed(scheduleId);
    if (!armed.paused) return;
    armed.job.resume();
    armed.paused = false;
    const next = armed.job.nextRun()?.toISOString() ?? null;
    this.log.info(
      `[scheduler] ${scheduleId} resumed` + (next ? ` next=${next}` : "")
    );
    void this.record(armed.schedule, { nextRunAt: next });
  }

  /**
   * Force one schedule to fire now (tests / ops).
   * Rejects if not armed or paused. Still respects lease + protect.
   */
  async trigger(scheduleId: string): Promise<void> {
    const armed = this.requireArmed(scheduleId);
    if (armed.paused) {
      throw new Error(
        `Schedule "${scheduleId}" is paused — resume before trigger`
      );
    }
    await armed.job.trigger();
  }

  private requireArmed(scheduleId: string): ArmedJob {
    const armed = this.armed.get(scheduleId);
    if (!armed) {
      throw new Error(`Schedule "${scheduleId}" is not armed`);
    }
    return armed;
  }

  private async arm(schedule: ScheduleDefinition): Promise<void> {
    const existing = await readScheduleEvidence(
      this.opts.dataDir,
      schedule.id
    );
    const base =
      existing ?? emptyEvidence(schedule.id, schedule.entrypoint);
    this.evidenceCache.set(schedule.id, base);

    const pattern = schedule.cron?.trim() || "* * * * * *";
    const intervalSec =
      schedule.every_ms != null && schedule.every_ms > 0
        ? Math.max(1, Math.ceil(schedule.every_ms / 1000))
        : undefined;

    const startAt = this.resolveStartAt(schedule, intervalSec);

    let job!: Cron;
    job = new Cron(
      pattern,
      {
        timezone: this.opts.timezone,
        protect: (blocked: Cron) => {
          this.log.warn(
            `[scheduler] ${schedule.id} skipped (protect — still running since ${blocked.currentRun()?.toISOString() ?? "?"})`
          );
          void this.record(schedule, {
            status: "skipped_protect",
            nextRunAt: job.nextRun()?.toISOString(),
          });
        },
        catch: (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.log.error(`[scheduler] ${schedule.id} error: ${message}`);
        },
        ...(intervalSec != null ? { interval: intervalSec } : {}),
        ...(startAt ? { startAt } : {}),
      },
      (): Promise<void> => this.onFire(schedule, job)
    );

    this.armed.set(schedule.id, {
      schedule,
      job,
      running: false,
      paused: false,
    });

    const next = job.nextRun()?.toISOString();
    await this.record(schedule, { nextRunAt: next });
    this.log.info(
      `[scheduler] ${schedule.id} → entrypoint=${schedule.entrypoint}` +
        (schedule.cron ? ` cron=${schedule.cron}` : "") +
        (schedule.every_ms != null ? ` every_ms=${schedule.every_ms}` : "") +
        (next ? ` next=${next}` : "")
    );
  }

  /**
   * Missed-tick skip: do not catch up a backlog.
   * For every_ms without runOnStart, first fire is one interval after start.
   * Cron-only relies on croner's next future match (no replay).
   */
  private resolveStartAt(
    schedule: ScheduleDefinition,
    intervalSec: number | undefined
  ): Date | undefined {
    if (this.opts.runOnStart) return undefined;
    if (schedule.cron?.trim() && intervalSec == null) {
      // Pure cron — next natural tick; no startAt needed.
      return undefined;
    }
    if (intervalSec != null) {
      return new Date(Date.now() + intervalSec * 1000);
    }
    return undefined;
  }

  private async onFire(schedule: ScheduleDefinition, job: Cron): Promise<void> {
    const armed = this.armed.get(schedule.id);
    if (!armed) return;
    if (armed.paused) {
      // pause() should stop ticks; ignore stray fires
      return;
    }
    if (armed.running) {
      // protect should already block; belt-and-suspenders
      return;
    }

    armed.running = true;
    const attemptedAt = new Date().toISOString();
    const lease = await tryAcquireLease(this.opts.dataDir, schedule.id, {
      staleMs: this.opts.staleMs,
    });

    if (!lease) {
      this.log.warn(
        `[scheduler] ${schedule.id} skipped (lease held by another host)`
      );
      await this.record(schedule, {
        status: "skipped_lease",
        nextRunAt: job.nextRun()?.toISOString(),
      });
      armed.running = false;
      return;
    }

    await this.record(schedule, {
      status: undefined,
      startedAt: attemptedAt,
      nextRunAt: job.nextRun()?.toISOString(),
    });

    let status: ScheduleRunStatus = "ok";
    let error: string | undefined;
    try {
      this.log.info(
        `[scheduler] ${schedule.id} invoke entrypoint=${schedule.entrypoint}`
      );
      await this.opts.invoke(schedule.entrypoint, {
        schedule,
        attemptedAt,
      });
    } catch (err) {
      status = "error";
      error = err instanceof Error ? err.message : String(err);
      this.log.error(`[scheduler] ${schedule.id} invoke failed: ${error}`);
    } finally {
      await lease.release();
      armed.running = false;
      await this.record(schedule, {
        status,
        error,
        finishedAt: new Date().toISOString(),
        nextRunAt: job.nextRun()?.toISOString(),
        incrementRuns: status === "ok" || status === "error",
      });
    }
  }

  private async record(
    schedule: ScheduleDefinition,
    patch: {
      status?: ScheduleRunStatus;
      error?: string;
      startedAt?: string;
      finishedAt?: string;
      /** ISO string, or null to clear (e.g. while paused). */
      nextRunAt?: string | null;
      incrementRuns?: boolean;
    }
  ): Promise<void> {
    const prev =
      this.evidenceCache.get(schedule.id) ??
      emptyEvidence(schedule.id, schedule.entrypoint);

    const next: ScheduleEvidence = {
      ...prev,
      entrypoint: schedule.entrypoint,
      scheduleId: schedule.id,
      updatedAt: new Date().toISOString(),
    };

    if (patch.startedAt) next.lastStartedAt = patch.startedAt;
    if (patch.finishedAt) next.lastFinishedAt = patch.finishedAt;
    if (patch.status) next.lastStatus = patch.status;
    if (patch.error !== undefined) {
      next.lastError = patch.error || undefined;
    } else if (patch.status === "ok") {
      next.lastError = undefined;
    }
    if (patch.nextRunAt !== undefined) {
      next.nextRunAt = patch.nextRunAt ?? undefined;
    }
    if (patch.incrementRuns) next.runs = (prev.runs ?? 0) + 1;

    this.evidenceCache.set(schedule.id, next);
    await writeScheduleEvidence(this.opts.dataDir, next);
    this.opts.onEvidence?.(next);
  }
}
