import type { EvalReport } from "./types.js";

/** Thrown when fixture evals (or dry-run) fail — blocks live run. */
export class EvalGateError extends Error {
  readonly report: EvalReport;

  constructor(report: EvalReport) {
    const lines = report.errors.length
      ? report.errors.map((e) => `- ${e}`).join("\n")
      : "- (no detail)";
    super(`Eval gate failed — live run refused:\n${lines}`);
    this.name = "EvalGateError";
    this.report = report;
  }
}

/**
 * Fail closed: throw unless every fixture case (and optional dry-run) passed.
 * Call after {@link runEvals} before starting a live AgentRuntime.
 */
export function assertEvalsGate(report: EvalReport): void {
  if (!report.passed) {
    throw new EvalGateError(report);
  }
}

/** True when the report may proceed to a live run. */
export function evalsAllowLive(report: EvalReport): boolean {
  return report.passed;
}
