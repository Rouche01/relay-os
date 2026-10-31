/** Workspace journey stages — one vocabulary everywhere (DESIGN.md § Copy). */

export const WORKSPACE_VIEWS = ["design", "verify", "ship", "activity"] as const;

export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number];

export type LifecyclePill = "Draft" | "Checks passed" | "Frozen" | "Live" | "Paused";

export const VIEW_LABEL: Record<WorkspaceView, string> = {
  design: "Design",
  verify: "Verify",
  ship: "Ship",
  activity: "Activity",
};

/** Next-gate CTA for shell placeholders — real gates land in w4–w9. */
export function nextGateForView(
  view: WorkspaceView
): { view: WorkspaceView; label: string } | null {
  switch (view) {
    case "design":
      return { view: "verify", label: "Run checks" };
    case "verify":
      return { view: "ship", label: "Go to Ship" };
    case "ship":
      return { view: "activity", label: "View activity" };
    case "activity":
      return null;
  }
}

export function isWorkspaceView(value: string): value is WorkspaceView {
  return (WORKSPACE_VIEWS as readonly string[]).includes(value);
}
