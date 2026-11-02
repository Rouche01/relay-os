import type { SpecValidationIssue } from "./types.ts";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 0-based line index for a validator hint, or -1. */
export function findYamlIssueLine(
  yaml: string,
  issue: Pick<SpecValidationIssue, "path" | "stepId" | "ruleId">
): number {
  const lines = yaml.split("\n");
  if (issue.stepId) {
    const needle = issue.stepId;
    for (let i = 0; i < lines.length; i++) {
      if (
        new RegExp(`^\\s+-\\s+id:\\s*["']?${escapeRegExp(needle)}\\b`).test(
          lines[i]!
        )
      ) {
        return i;
      }
    }
  }
  if (issue.ruleId) {
    const needle = issue.ruleId;
    for (let i = 0; i < lines.length; i++) {
      if (
        new RegExp(`^\\s+-\\s+id:\\s*["']?${escapeRegExp(needle)}\\b`).test(
          lines[i]!
        )
      ) {
        return i;
      }
    }
  }
  if (issue.path) {
    const leaf = issue.path.split("/").filter(Boolean).pop();
    if (leaf && !/^\d+$/.test(leaf)) {
      for (let i = 0; i < lines.length; i++) {
        if (new RegExp(`^\\s*${escapeRegExp(leaf)}\\s*:`).test(lines[i]!)) {
          return i;
        }
      }
    }
  }
  return -1;
}

/** Focus a YAML textarea on a 0-based line (Design drawer / Spec surface). */
export function focusYamlLine(
  textarea: HTMLTextAreaElement | null,
  yaml: string,
  lineIndex: number,
  opts?: { beforeFocus?: () => void }
): void {
  if (!textarea || lineIndex < 0) return;
  opts?.beforeFocus?.();
  const lines = yaml.split("\n");
  let start = 0;
  for (let i = 0; i < lineIndex; i++) {
    start += (lines[i]?.length ?? 0) + 1;
  }
  const end = start + (lines[lineIndex]?.length ?? 0);
  textarea.focus();
  textarea.setSelectionRange(start, end);
  const lineHeight =
    Number.parseFloat(getComputedStyle(textarea).lineHeight) || 18;
  textarea.scrollTop = Math.max(
    0,
    lineIndex * lineHeight - textarea.clientHeight / 3
  );
}
