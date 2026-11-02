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
  /** Seed draft from parent (optional — store is source of truth). */
  draft?: DraftRecord;
  settings?: DeskSettings;
  onDraftUpdated?: (draft: DraftRecord) => void;
  onReDraft?: () => void;
  /** After Ship enable — typically navigate to Apps. */
  onShipped?: () => void;
  /** Activity HITL → Seats. */
  onOpenSeats?: () => void;
};

export function Workspace({
  entityId,
  title,
  lifecycle: lifecycleProp,
  specHash,
  trigger,
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

  return (
    <div class="desk-body workspace-surface">
      <WorkspaceHeader
        backLabel={backLabel}
        onBack={onBack}
        title={title?.trim() || liveDraft?.goal || entityId}
        lifecycle={lifecycle}
        specHash={specHash ?? liveDraft?.specHash}
        trigger={trigger}
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

      <nav class="ws-journey" aria-label="Journey">
        <ol class="ws-journey-list">
          {steps.map((step, i) => (
            <li
              key={step.id}
              class="ws-journey-item"
              data-status={step.status}
            >
              {i > 0 ? (
                <span class="ws-journey-sep" aria-hidden="true">
                  →
                </span>
              ) : null}
              <button
                type="button"
                class="ws-journey-step"
                data-status={step.status}
                aria-current={step.status === "current" ? "page" : undefined}
                onClick={() => onViewChange(step.id)}
              >
                {step.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

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
      ) : view === "design" ||
        view === "verify" ||
        view === "ship" ||
        view === "activity" ? (
        <section class="ws-view" aria-label={VIEW_LABEL[view]}>
          <p class="tile-meta">Draft not found on this Desk.</p>
        </section>
      ) : (
        <section class="ws-view" aria-label={VIEW_LABEL[view]}>
          <p class="tile-meta mono">{entityId}</p>
        </section>
      )}
    </div>
  );
}
