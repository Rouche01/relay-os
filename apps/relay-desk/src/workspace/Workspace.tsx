import { useCallback, useState } from "preact/hooks";
import type { DeskSettings } from "../gateway/types.ts";
import type { SpecValidationIssue } from "../spec/types.ts";
import type { DraftRecord } from "../specs/draft-store.ts";
import { DesignView } from "./views/DesignView.tsx";
import { VerifyView } from "./views/VerifyView.tsx";
import { ShipView } from "./views/ShipView.tsx";
import { ActivityView } from "./views/ActivityView.tsx";
import { WorkspaceHeader } from "./header.tsx";
import { useWorkspaceDraft } from "./useWorkspaceDraft.ts";
import {
  VIEW_LABEL,
  deriveJourneySteps,
  lifecycleFromDraft,
  nextGateForView,
  type LifecyclePill,
  type WorkspaceView,
} from "./journey.ts";

export type WorkspaceProps = {
  entityId: string;
  title?: string;
  lifecycle?: LifecyclePill;
  specHash?: string;
  trigger?: string;
  view: WorkspaceView;
  backLabel: string;
  onBack: () => void;
  onViewChange: (view: WorkspaceView) => void;
  draft?: DraftRecord;
  settings?: DeskSettings;
  onDraftUpdated?: (draft: DraftRecord) => void;
  onReDraft?: () => void;
  onShipped?: () => void;
  onOpenSeats?: () => void;
};

function stageMark(status: "done" | "current" | "upcoming"): string {
  if (status === "current") return "●";
  if (status === "done") return "●";
  return "○";
}

export function Workspace({
  entityId,
  title,
  lifecycle: lifecycleProp,
  view,
  backLabel,
  onBack,
  onViewChange,
  draft: draftProp,
  settings,
  onDraftUpdated,
  onReDraft,
  onShipped,
  onOpenSeats,
}: WorkspaceProps) {
  const { draft: liveDraft, adoptDraft } = useWorkspaceDraft(
    entityId,
    draftProp
  );
  const [focusIssue, setFocusIssue] = useState<
    Pick<SpecValidationIssue, "path" | "stepId" | "ruleId"> | undefined
  >();

  const lifecycle =
    liveDraft != null
      ? lifecycleFromDraft(liveDraft)
      : (lifecycleProp ?? "Draft");
  const next = nextGateForView(view, lifecycle);
  const steps = deriveJourneySteps(lifecycle, view);

  const handleDraftUpdated = useCallback(
    (nextDraft: DraftRecord) => {
      adoptDraft(nextDraft);
      onDraftUpdated?.(nextDraft);
    },
    [onDraftUpdated, adoptDraft]
  );

  const jumpToDesign = useCallback(
    (issue: Pick<SpecValidationIssue, "path" | "stepId" | "ruleId">) => {
      setFocusIssue(issue);
      onViewChange("design");
    },
    [onViewChange]
  );

  const goal = title?.trim() || liveDraft?.goal || entityId;

  return (
    <div class="desk-body workspace-surface">
      <WorkspaceHeader
        surfaceLabel="Build"
        backLabel={backLabel}
        onBack={onBack}
        title={goal}
        lifecycle={lifecycle}
        view={view}
        nextGate={
          next
            ? {
                label: next.label,
                onClick: () => {
                  if (next.view !== view) onViewChange(next.view);
                },
              }
            : null
        }
      />

      <div class="ws-body">
        <nav class="ws-stage-rail" aria-label="Stages">
          {steps.map((step) => (
            <button
              key={step.id}
              type="button"
              class="ws-stage-rail-btn"
              data-status={step.status}
              aria-current={step.status === "current" ? "page" : undefined}
              onClick={() => onViewChange(step.id)}
            >
              <span class="ws-stage-mark" aria-hidden="true">
                {stageMark(step.status)}
              </span>
              <span class="ws-stage-label">{step.label}</span>
            </button>
          ))}
        </nav>

        <div class="ws-panel" aria-label={VIEW_LABEL[view]}>
          {liveDraft && settings ? (
            <>
              {/*
                Keep Design (and its React Flow canvas) mounted under stage
                overlays. Remounting flickers; visibility:hidden empties RF.
              */}
              <div
                class="ws-stage-layer ws-stage-design"
                data-active={view === "design" ? "1" : "0"}
                aria-hidden={view !== "design"}
              >
                <DesignView
                  draft={liveDraft}
                  settings={settings}
                  onDraftUpdated={handleDraftUpdated}
                  onReDraft={() => onReDraft?.()}
                  focusIssue={focusIssue}
                  onFocusIssueConsumed={() => setFocusIssue(undefined)}
                />
              </div>
              {view === "verify" ? (
                <div class="ws-stage-layer ws-stage-overlay">
                  <VerifyView
                    draft={liveDraft}
                    settings={settings}
                    onDraftUpdated={handleDraftUpdated}
                    onJumpToDesign={jumpToDesign}
                  />
                </div>
              ) : null}
              {view === "ship" ? (
                <div class="ws-stage-layer ws-stage-overlay">
                  <ShipView
                    draft={liveDraft}
                    settings={settings}
                    onDraftUpdated={handleDraftUpdated}
                    onEnabled={() => onShipped?.()}
                  />
                </div>
              ) : null}
              {view === "activity" ? (
                <div class="ws-stage-layer ws-stage-overlay">
                  <ActivityView
                    draft={liveDraft}
                    settings={settings}
                    onDraftUpdated={handleDraftUpdated}
                    onOpenSeats={() => onOpenSeats?.()}
                    onEditSpec={() => onViewChange("design")}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <p class="tile-meta">Draft not found on this Desk.</p>
          )}
        </div>
      </div>
    </div>
  );
}
