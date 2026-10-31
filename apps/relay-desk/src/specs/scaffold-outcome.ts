import type { ScaffoldNeed, SpecValidationResult } from "../spec/types.ts";

/** Chip after a scaffold attempt — distinct from raw API `mode`. */
export type ScaffoldOutcome = "llm" | "stub" | "needs_edits" | "needs";

export function needActionLabel(action: ScaffoldNeed["action"] | string): string {
  switch (action) {
    case "import_descriptor":
      return "Import descriptor";
    case "add_connection":
      return "Add connection";
    case "expand_operations":
      return "Expand operations";
    default:
      return action;
  }
}

export function resolveScaffoldOutcome(res: {
  ok: boolean;
  mode?: string;
  yaml?: string;
  validation?: SpecValidationResult;
  needs?: unknown[];
}): ScaffoldOutcome | undefined {
  if (res.mode === "needs" || (res.needs && res.needs.length > 0)) {
    return "needs";
  }
  if (!res.yaml?.trim()) return undefined;
  if (!res.ok || res.validation?.ok === false) return "needs_edits";
  if (res.mode === "stub") return "stub";
  return "llm";
}
