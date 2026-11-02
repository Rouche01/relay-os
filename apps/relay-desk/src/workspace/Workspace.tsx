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

      <nav class="ws-journey-bar" aria-label="Journey">
        <ol class="ws-journey-bar-list">
          {steps.map((step, i) => (
            <li key={step.id} class="ws-journey-bar-item">
              {i > 0 ? (
                <span class="ws-journey-bar-sep" aria-hidden="true">
                  ──
                </span>
              ) : null}
              <button
                type="button"
                class="ws-journey-bar-step"
                data-status={step.status}
                aria-current={step.status === "current" ? "page" : undefined}
                onClick={() => onViewChange(step.id)}
              >
                <span aria-hidden="true">{stageMark(step.status)}</span>{" "}
                {step.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

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
              <span aria-hidden="true">{stageMark(step.status)}</span>{" "}
              {step.label}
            </button>
          ))}
        </nav>

        <div class="ws-panel" aria-label={VIEW_LABEL[view]}>
          {view === "design" && liveDraft && settings ? (
            <DesignView
              draft={liveDraft}
              settings={settings}
              onDraftUpdated={handleDraftUpdated}
              onReDraft={() => onReDraft?.()}
              focusIssue={focusIssue}
              onFocusIssueConsumed={() => setFocusIssue(undefined)}
            />
          ) : view === "verify" && liveDraft && settings ? (
            <VerifyView
              draft={liveDraft}
              settings={settings}
              onDraftUpdated={handleDraftUpdated}
              onJumpToDesign={jumpToDesign}
            />
          ) : view === "ship" && liveDraft && settings ? (
            <ShipView
              draft={liveDraft}
              settings={settings}
              onDraftUpdated={handleDraftUpdated}
              onEnabled={() => onShipped?.()}
            />
          ) : view === "activity" && liveDraft && settings ? (
            <ActivityView
              draft={liveDraft}
              settings={settings}
              onDraftUpdated={handleDraftUpdated}
              onOpenSeats={() => onOpenSeats?.()}
              onEditSpec={() => onViewChange("design")}
            />
          ) : (
            <p class="tile-meta">Draft not found on this Desk.</p>
          )}
        </div>
      </div>
    </div>
  );
}
