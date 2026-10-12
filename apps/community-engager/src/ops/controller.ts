import type { SchedulerHost } from "@relay/scheduler";
import type { AgenticAppManifest } from "@relay/protocol";
import type { CommunityEntrypoint } from "../manifest.js";
import { formatRunSummary, type RunSummary } from "../metrics/job-queue.js";
import { formatOpsHelp, parseOpsIntent } from "./parse.js";
import type { OpsCommand } from "./command.js";

export interface OpsAppHandle {
  run(): Promise<RunSummary>;
}

export interface OpsControllerOptions {
  host: SchedulerHost;
  /** Factory for one-off / schedule-invoked app runs (shared adapter). */
  createApp: (entrypoint: CommunityEntrypoint) => OpsAppHandle;
  /** Manifest used when parsing freeform text. */
  manifest: AgenticAppManifest;
  /** Settle delay after schedule trigger (croner + lease IO). Default 250ms. */
  triggerSettleMs?: number;
}

/**
 * App-local ops plane: parse intents and drive SchedulerHost + one-off runs.
 * Rejects overlapping one-offs (v1: no queue).
 */
export class OpsController {
  private readonly host: SchedulerHost;
  private readonly createApp: OpsControllerOptions["createApp"];
  private readonly manifest: AgenticAppManifest;
  private readonly triggerSettleMs: number;
  private oneOffBusy = false;

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
        return this.runOneOff(cmd.entrypoint);
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

  isOneOffBusy(): boolean {
    return this.oneOffBusy;
  }

  private async ensureStarted(): Promise<void> {
    if (!this.host.isStarted()) {
      await this.host.start();
    }
  }

  private async runOneOff(entrypoint: CommunityEntrypoint): Promise<string> {
    if (this.oneOffBusy) {
      return "Busy: a one-off run is already in progress. Try again when it finishes.";
    }
    this.oneOffBusy = true;
    try {
      const app = this.createApp(entrypoint);
      const summary = await app.run();
      return `One-off ${entrypoint} finished.\n${formatRunSummary(summary)}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `One-off ${entrypoint} failed: ${message}`;
    } finally {
      this.oneOffBusy = false;
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
    if (!this.host.isStarted()) {
      return "Scheduler already stopped.";
    }
    this.host.stop();
    return "Scheduler stopped (all schedules disarmed).";
  }

  private async triggerSchedule(scheduleId: string): Promise<string> {
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
    if (!this.host.isStarted()) {
      return "Scheduler stopped (no armed schedules).";
    }
    const rows = this.host.listStatus();
    if (rows.length === 0) {
      return "Scheduler started but no schedules armed.";
    }
    const lines = rows.map((row) => {
      const timing = row.schedule.cron
        ? `cron=${row.schedule.cron}`
        : row.schedule.every_ms != null
          ? `every_ms=${row.schedule.every_ms}`
          : "";
      const flags = [
        row.paused ? "paused" : "active",
        row.running ? "running" : null,
      ]
        .filter(Boolean)
        .join(",");
      const next = row.nextRunAt ? ` next=${row.nextRunAt}` : "";
      const last = row.evidence.lastStatus
        ? ` last=${row.evidence.lastStatus}`
        : "";
      return `  · ${row.schedule.id} → ${row.schedule.entrypoint} [${flags}] ${timing}${next}${last}`;
    });
    return `Armed schedules:\n${lines.join("\n")}`;
  }
}
