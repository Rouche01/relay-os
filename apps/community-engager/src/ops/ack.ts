import type { AgenticAppManifest } from "@relay/protocol";
import type { OpsCommand } from "./command.js";
import {
  opsCommandConflictsWithRun,
  type OpsController,
} from "./controller.js";
import { parseOpsIntent } from "./parse.js";

/**
 * Immediate “still working” line for intents that can take a while.
 * Returns null for fast ops (`status`, pause/resume, help).
 */
export function opsProcessingAck(cmd: OpsCommand): string | null {
  switch (cmd.kind) {
    case "one_off":
      return cmd.forceDiscover
        ? `⏳ Starting one-off ${cmd.entrypoint} (force discover)… (HITL may follow)`
        : `⏳ Starting one-off ${cmd.entrypoint}… (HITL may follow)`;
    case "trigger":
      return `⏳ Triggering schedule "${cmd.scheduleId}"…`;
    case "start_all":
      return `⏳ Starting / resuming schedules…`;
    default:
      return null;
  }
}

/**
 * Parse → optional processing ack → {@link OpsController.handle}.
 * Skips ack when the command would busy-reject against an active run.
 */
export async function handleOpsWithAck(
  ops: OpsController,
  text: string,
  manifest: AgenticAppManifest,
  notify: (message: string) => void | Promise<void>
): Promise<string> {
  const cmd = parseOpsIntent(text, manifest);
  if (ops.isRunBusy() && opsCommandConflictsWithRun(cmd)) {
    return ops.handle(cmd);
  }
  const ack = opsProcessingAck(cmd);
  if (ack) await notify(ack);
  return ops.handle(cmd);
}
