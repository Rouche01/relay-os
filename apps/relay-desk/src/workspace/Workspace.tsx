import { useCallback, useEffect, useState } from "preact/hooks";
import type { DeskSettings } from "../gateway/types.ts";
import type { DraftRecord } from "../specs/draft-store.ts";
import { DesignView } from "./views/DesignView.tsx";
import { WorkspaceHeader } from "./header.tsx";
import {
  VIEW_LABEL,
  deriveJourneySteps,
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
  /** Draft entity for Build workspace (Design/Verify/…). */
  draft?: DraftRecord;
  settings?: DeskSettings;
  onDraftUpdated?: (draft: DraftRecord) => void;
  onReDraft?: () => void;
};

const PLACEHOLDER: Record<Exclude<WorkspaceView, "design">, string> = {
  verify: "Is it correct and safe? — checks land in w7.",
  ship: "Can it go live? — checklist lands in w8.",
  activity: "What did it do? — runs + overlay land in w9.",
};

export function Workspace({
  entityId,
  title,
  lifecycle = "Draft",
  specHash,
  trigger,
  view,
  backLabel,
  onBack,
  onViewChange,
  draft,
  settings,
  onDraftUpdated,
  onReDraft,
}: WorkspaceProps) {
  const next = nextGateForView(view, lifecycle);
  const steps = deriveJourneySteps(lifecycle, view);
  const [liveDraft, setLiveDraft] = useState(draft);

  useEffect(() => {
    setLiveDraft(draft);
  }, [draft]);

  const handleDraftUpdated = useCallback(
    (nextDraft: DraftRecord) => {
      setLiveDraft(nextDraft);
      onDraftUpdated?.(nextDraft);
    },
    [onDraftUpdated]
  );

  return (
    <div class="desk-body workspace-surface">
      <WorkspaceHeader
        backLabel={backLabel}
        onBack={onBack}
        title={title?.trim() || liveDraft?.goal || entityId}
        lifecycle={lifecycle}
        specHash={specHash}
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
        />
      ) : view === "design" ? (
        <section class="ws-view" aria-label="Design">
          <p class="tile-meta">Draft not found on this Desk.</p>
        </section>
      ) : (
        <section class="ws-view" aria-label={VIEW_LABEL[view]}>
          <p class="tile-label">{VIEW_LABEL[view]}</p>
          <h2 class="tile-title">{PLACEHOLDER[view]}</h2>
          <p class="tile-meta mono">{entityId}</p>
        </section>
      )}
    </div>
  );
}
