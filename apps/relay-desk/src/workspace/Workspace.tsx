import { WorkspaceHeader } from "./header.tsx";
import {
  VIEW_LABEL,
  deriveJourneySteps,
  nextGateForView,
  type LifecyclePill,
  type WorkspaceView,
} from "./journey.ts";

export type WorkspaceProps = {
  /** Draft id or installed app id — display only until stores land. */
  entityId: string;
  title?: string;
  lifecycle?: LifecyclePill;
  specHash?: string;
  trigger?: string;
  view: WorkspaceView;
  backLabel: string;
  onBack: () => void;
  onViewChange: (view: WorkspaceView) => void;
};

const PLACEHOLDER: Record<WorkspaceView, string> = {
  design: "What will it do? — schematic + intent land in w6.",
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
}: WorkspaceProps) {
  const next = nextGateForView(view, lifecycle);
  const steps = deriveJourneySteps(lifecycle, view);

  return (
    <div class="desk-body workspace-surface">
      <WorkspaceHeader
        backLabel={backLabel}
        onBack={onBack}
        title={title?.trim() || entityId}
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

      <section class="ws-view" aria-label={VIEW_LABEL[view]}>
        <p class="tile-label">{VIEW_LABEL[view]}</p>
        <h2 class="tile-title">{PLACEHOLDER[view]}</h2>
        <p class="tile-meta mono">{entityId}</p>
      </section>
    </div>
  );
}
