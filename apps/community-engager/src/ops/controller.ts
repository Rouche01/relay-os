import type { SchedulerHost } from "@relay/scheduler";
import type { AgenticAppManifest } from "@relay/protocol";
import type { CommunityEntrypoint } from "../manifest.js";
import { formatRunSummary, type RunSummary } from "../metrics/job-queue.js";
import { formatOpsHelp, parseOpsIntent } from "./parse.js";
import type { OpsCommand } from "./command.js";

export interface OpsAppHandle {
  run(): Promise<RunSummary>;
}

export type OpsRunKind = "one_off" | "schedule";

export interface OpsActiveRun {
  kind: OpsRunKind;
  /** Human label for busy replies (e.g. `one-off engage`, `schedule cadence`). */
  label: string;
}

export interface OpsCreateAppOptions {
  maxJobs?: number;
  /** Engage: set context.forceDiscover before stages (manual; uncapped by empty-scout day ledger). */
  forceDiscover?: boolean;
}

export interface OpsControllerOptions {
  host: SchedulerHost;
  /** Factory for one-off / schedule-invoked app runs (shared adapter). */
  createApp: (
    entrypoint: CommunityEntrypoint,
    options?: OpsCreateAppOptions
  ) => OpsAppHandle;
  /** Manifest used when parsing freeform text. */
  manifest: AgenticAppManifest;
  /** Settle delay after schedule trigger (croner + lease IO). Default 250ms. */
  triggerSettleMs?: number;
}

export interface RunScheduledResult {
  /** True when the app run completed (ok or error). */
  ran: boolean;
  /** True when skipped because another run holds the mutex. */
  skipped: boolean;
  summary?: RunSummary;
  message: string;
}

/** Ops that must not start / stop the host or fire apps while a run is active. */
export function opsCommandConflictsWithRun(cmd: OpsCommand): boolean {
  return (
    cmd.kind === "one_off" ||
    cmd.kind === "trigger" ||
    cmd.kind === "start_all" ||
    cmd.kind === "stop_all"
  );
}

/**
 * App-local ops plane: parse intents and drive SchedulerHost + app runs.
 * One mutex for one-offs and schedule invokes (v1: no queue).
 */
export class OpsController {
  private readonly host: SchedulerHost;
  private readonly createApp: OpsControllerOptions["createApp"];
  private readonly manifest: AgenticAppManifest;
  private readonly triggerSettleMs: number;
  private activeRun: OpsActiveRun | null = null;

  constructor(options: OpsControllerOptions) {
    this.host = options.host;
    this.createApp = options.createApp;
    this.manifest = options.manifest;
    this.triggerSettleMs = options.triggerSettleMs ?? 250;
  }

  /** Parse text then {@link handle}. */
  async handleText(text: string): Promise<string> {
    return this.handle(parseOpsIntent(text, this.manifest));
  }

  async handle(cmd: OpsCommand): Promise<string> {
    switch (cmd.kind) {
      case "help":
        return formatOpsHelp(cmd.reason);
      case "status":
        return this.formatStatus();
      case "one_off":
        return this.runOneOff(cmd.entrypoint, {
          ...(cmd.forceDiscover ? { forceDiscover: true } : {}),
        });
      case "start_schedule":
        return this.startSchedule(cmd.scheduleId);
      case "stop_schedule":
        return this.stopSchedule(cmd.scheduleId);
      case "start_all":
        return this.startAll();
      case "stop_all":
        return this.stopAll();
      case "trigger":
        return this.triggerSchedule(cmd.scheduleId);
      default: {
        const _exhaustive: never = cmd;
        return formatOpsHelp(`unhandled: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  isRunBusy(): boolean {
    return this.activeRun != null;
  }

  getActiveRun(): OpsActiveRun | null {
    return this.activeRun;
  }

  /** @deprecated Prefer {@link isRunBusy} — true when any app run holds the mutex. */
  isOneOffBusy(): boolean {
    return this.isRunBusy();
  }

  busyMessage(action?: string): string {
    const label = this.activeRun?.label ?? "a run";
    const prefix = action ? `Busy (${action})` : "Busy";
    return `${prefix}: ${label} is already in progress. Try again when it finishes.`;
  }

  /**
   * Schedule / cron path: same mutex as one-offs.
   * When busy, skip + return (do not throw — safe inside croner invoke).
   */
  async runScheduled(args: {
    scheduleId: string;
    entrypoint: CommunityEntrypoint;
    maxJobs?: number;
  }): Promise<RunScheduledResult> {
    const label = `schedule ${args.scheduleId}`;
    if (!this.tryBeginRun({ kind: "schedule", label })) {
      const message = `Busy: ${this.activeRun!.label} in progress — skipped ${label}`;
      console.warn(`[ops] ${message}`);
      return { ran: false, skipped: true, message };
    }
    try {
      const app = this.createApp(args.entrypoint, {
        ...(args.maxJobs != null ? { maxJobs: args.maxJobs } : {}),
      });
      const summary = await app.run();
      const message = `Schedule ${args.scheduleId} finished.\n${formatRunSummary(summary)}`;
      return { ran: true, skipped: false, summary, message };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const message = `Schedule ${args.scheduleId} failed: ${errMsg}`;
      console.error(`[ops] ${message}`);
      return { ran: false, skipped: false, message };
    } finally {
      this.endRun();
    }
  }

  private tryBeginRun(run: OpsActiveRun): boolean {
    if (this.activeRun) return false;
    this.activeRun = run;
    return true;
  }

  private endRun(): void {
    this.activeRun = null;
  }

  private async ensureStarted(): Promise<void> {
    if (!this.host.isStarted()) {
      await this.host.start();
    }
  }

  private async runOneOff(
    entrypoint: CommunityEntrypoint,
    options?: OpsCreateAppOptions
  ): Promise<string> {
    const label = options?.forceDiscover
      ? `one-off ${entrypoint} (force discover)`
      : `one-off ${entrypoint}`;
    if (!this.tryBeginRun({ kind: "one_off", label })) {
      return this.busyMessage(label);
    }
    try {
      const app = this.createApp(entrypoint, options);
      const summary = await app.run();
      return `One-off ${entrypoint}${options?.forceDiscover ? " (force discover)" : ""} finished.\n${formatRunSummary(summary)}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `One-off ${entrypoint} failed: ${message}`;
    } finally {
      this.endRun();
    }
  }

  private async startSchedule(scheduleId: string): Promise<string> {
    await this.ensureStarted();
    if (!this.host.isArmed(scheduleId)) {
      const known = this.host.listStatus().map((s) => s.schedule.id);
      return `Schedule "${scheduleId}" is not armed (known: ${known.join(", ") || "none"}). Check config enabled flags.`;
    }
    this.host.resume(scheduleId);
    return `Schedule "${scheduleId}" resumed (armed).`;
  }

  private async stopSchedule(scheduleId: string): Promise<string> {
    if (!this.host.isStarted() || !this.host.isArmed(scheduleId)) {
      return `Schedule "${scheduleId}" is not armed — nothing to pause.`;
    }
    this.host.pause(scheduleId);
    return `Schedule "${scheduleId}" paused.`;
  }

  private async startAll(): Promise<string> {
    if (this.isRunBusy()) {
      return this.busyMessage("start schedules");
    }
    if (this.host.isStarted()) {
      for (const row of this.host.listStatus()) {
        if (row.paused) this.host.resume(row.schedule.id);
      }
      return `Schedules resumed: ${this.formatStatus()}`;
    }
    await this.host.start();
    return `Scheduler started.\n${this.formatStatus()}`;
  }

  private stopAll(): string {
    if (this.isRunBusy()) {
      return this.busyMessage("stop schedules");
    }
    if (!this.host.isStarted()) {
      return "Scheduler already stopped.";
    }
    this.host.stop();
    return "Scheduler stopped (all schedules disarmed).";
  }

  private async triggerSchedule(scheduleId: string): Promise<string> {
    if (this.isRunBusy()) {
      return this.busyMessage(`trigger ${scheduleId}`);
    }
    await this.ensureStarted();
    if (!this.host.isArmed(scheduleId)) {
      const known = this.host.listStatus().map((s) => s.schedule.id);
      return `Schedule "${scheduleId}" is not armed (known: ${known.join(", ") || "none"}).`;
    }
    if (this.host.isPaused(scheduleId)) {
      return `Schedule "${scheduleId}" is paused — resume before trigger (e.g. "start ${scheduleId === "post_watch" ? "post watch" : scheduleId}").`;
    }
    try {
      await this.host.trigger(scheduleId);
      await new Promise((r) => setTimeout(r, this.triggerSettleMs));
      return `Triggered "${scheduleId}".\n${this.formatStatus()}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Trigger "${scheduleId}" failed: ${message}`;
    }
  }

  private formatStatus(): string {
    const runLine = this.activeRun
      ? `Active run: ${this.activeRun.label}\n`
      : "";
    if (!this.host.isStarted()) {
      return `${runLine}Scheduler stopped (no armed schedules).`;
    }
    const rows = this.host.listStatus();
    if (rows.length === 0) {
      return `${runLine}Scheduler started but no schedules armed.`;
    }
    const lines = rows.map((row) => {
      const timing = row.schedule.cron
        ? `cron=${row.schedule.cron}`
        : row.schedule.every_ms != null
          ? `every_ms=${row.schedule.every_ms}`
          : "";
      const flags = [
        "armed",
        row.paused ? "paused" : "active",
        row.running ? "running" : null,
      ]
        .filter(Boolean)
        .join(",");
      const next = row.paused
        ? " next=—"
        : row.nextRunAt
          ? ` next=${row.nextRunAt}`
          : "";
      const last = row.evidence.lastStatus
        ? ` last=${row.evidence.lastStatus}`
        : "";
      return `  · ${row.schedule.id} → ${row.schedule.entrypoint} [${flags}] ${timing}${next}${last}`;
    });
    const pausedN = rows.filter((r) => r.paused).length;
    const header =
      pausedN > 0
        ? `Armed schedules (${pausedN} paused):`
        : "Armed schedules:";
    return `${runLine}${header}\n${lines.join("\n")}`;
  }
}
