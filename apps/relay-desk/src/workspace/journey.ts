/**
 * Workspace journey — one stage vocabulary (DESIGN.md § Copy).
 * Lifecycle lives in the header pill; gates stay inside views.
 */

import type { InstalledAppSummary } from "../apps/types.ts";
import type { DraftRecord, DraftStatus } from "../specs/draft-store.ts";
import type { SpecPipelineInput } from "../spec/pipeline.ts";

export const WORKSPACE_VIEWS = ["design", "verify", "ship", "activity"] as const;

export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number];

export type LifecyclePill =
  | "Draft"
  | "Checks passed"
  | "Frozen"
  | "Live"
  | "Paused"
  | "Needs catalog";

export type JourneyStepStatus = "done" | "current" | "upcoming";

export type JourneyStep = {
  id: WorkspaceView;
  label: string;
  status: JourneyStepStatus;
};

export type LibraryRowAction = {
  label: string;
  view: WorkspaceView;
};

export const VIEW_LABEL: Record<WorkspaceView, string> = {
  design: "Design",
  verify: "Verify",
  ship: "Ship",
  activity: "Activity",
};

const VIEW_INDEX: Record<WorkspaceView, number> = {
  design: 0,
  verify: 1,
  ship: 2,
  activity: 3,
};

function evalsPassed(input: SpecPipelineInput): boolean {
  return input.evals?.ok === true || input.evals?.report?.passed === true;
}

/** Map optional pipeline cache onto a persisted draft status. */
export function draftStatusFromPipeline(
  input: SpecPipelineInput,
  opts?: { needsCatalog?: boolean }
): DraftStatus {
  if (opts?.needsCatalog) return "needs_catalog";
  if (input.frozenId) return "frozen";
  if (input.validation?.ok === true && evalsPassed(input)) {
    return "checks_passed";
  }
  return "draft";
}

export function lifecycleFromDraftStatus(status: DraftStatus): LifecyclePill {
  switch (status) {
    case "draft":
      return "Draft";
    case "checks_passed":
      return "Checks passed";
    case "frozen":
      return "Frozen";
    case "needs_catalog":
      return "Needs catalog";
  }
}

/**
 * Prefer live pipeline when present (workspace store); else draft.status.
 */
export function lifecycleFromDraft(
  draft: DraftRecord,
  pipeline?: SpecPipelineInput
): LifecyclePill {
  if (draft.scheduleEnabled) return "Live";
  if (draft.status === "needs_catalog") return "Needs catalog";
  if (pipeline) {
    return lifecycleFromDraftStatus(draftStatusFromPipeline(pipeline));
  }
  return lifecycleFromDraftStatus(draft.status);
}

/** Installed / approved app fleet lifecycle. */
export function lifecycleFromApp(app: InstalledAppSummary): LifecyclePill {
  if (app.editing) return "Draft";
  if (app.scheduleState === "paused") return "Paused";
  if (app.scheduleState === "enabled") return "Live";
  // disabled
  if (app.needsShadowGate) return "Frozen";
  return "Frozen";
}

/** Furthest journey view implied by lifecycle (gates still happen inside views). */
export function progressViewForLifecycle(lifecycle: LifecyclePill): WorkspaceView {
  switch (lifecycle) {
    case "Draft":
    case "Needs catalog":
      return "design";
    case "Checks passed":
      return "verify";
    case "Frozen":
      return "ship";
    case "Live":
    case "Paused":
      return "activity";
  }
}

/**
 * Journey bar: 4 views only. Steps at/before progress are `done` unless active
 * (`current`); later steps are `upcoming`. Active route always paints `current`.
 */
export function deriveJourneySteps(
  lifecycle: LifecyclePill,
  activeView: WorkspaceView
): JourneyStep[] {
  const progress = VIEW_INDEX[progressViewForLifecycle(lifecycle)];
  return WORKSPACE_VIEWS.map((id) => {
    const i = VIEW_INDEX[id];
    let status: JourneyStepStatus;
    if (id === activeView) status = "current";
    else if (i <= progress) status = "done";
    else status = "upcoming";
    return { id, label: VIEW_LABEL[id], status };
  });
}

export function statePhraseForLifecycle(lifecycle: LifecyclePill): string {
  switch (lifecycle) {
    case "Draft":
      return "Draft · not checked yet";
    case "Checks passed":
      return "Checks passed · not frozen";
    case "Frozen":
      return "Frozen · not live yet";
    case "Live":
      return "Live · schedule on";
    case "Paused":
      return "Paused · schedule held";
    case "Needs catalog":
      return "Needs catalog · connection or descriptor";
  }
}

export function actionForLifecycle(lifecycle: LifecyclePill): LibraryRowAction {
  switch (lifecycle) {
    case "Draft":
      return { label: "Open design", view: "design" };
    case "Needs catalog":
      return { label: "See what's missing", view: "design" };
    case "Checks passed":
      return { label: "Finish setup", view: "ship" };
    case "Frozen":
      return { label: "Finish setup", view: "ship" };
    case "Live":
    case "Paused":
      return { label: "View runs", view: "activity" };
  }
}

/**
 * Contextual next-gate CTA. Labels stay user-facing; freeze/shadow/enable stay in Ship.
 */
export function nextGateForView(
  view: WorkspaceView,
  lifecycle: LifecyclePill = "Draft"
): { view: WorkspaceView; label: string } | null {
  switch (view) {
    case "design":
      if (lifecycle === "Needs catalog") {
        return { view: "design", label: "See what's missing" };
      }
      return { view: "verify", label: "Run checks" };
    case "verify":
      if (lifecycle === "Draft" || lifecycle === "Needs catalog") {
        return { view: "verify", label: "Run checks" };
      }
      return { view: "ship", label: "Go to Ship" };
    case "ship":
      if (lifecycle === "Live" || lifecycle === "Paused") {
        return { view: "activity", label: "View activity" };
      }
      return { view: "ship", label: "Finish setup" };
    case "activity":
      return null;
  }
}

/** data-lifecycle attribute for CSS (no spaces). */
export function lifecycleDataAttr(lifecycle: LifecyclePill): string {
  return lifecycle.toLowerCase().replace(/\s+/g, "-");
}

export function isWorkspaceView(value: string): value is WorkspaceView {
  return (WORKSPACE_VIEWS as readonly string[]).includes(value);
}
