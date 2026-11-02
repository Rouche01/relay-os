import type { LifecyclePill, WorkspaceView } from "./journey.ts";
import { VIEW_LABEL, lifecycleDataAttr } from "./journey.ts";

export type WorkspaceHeaderProps = {
  /** Rail surface name — Build (Flowstep “Spec”). */
  surfaceLabel?: string;
  backLabel: string;
  onBack: () => void;
  title: string;
  lifecycle: LifecyclePill;
  view: WorkspaceView;
  nextGate?: { label: string; onClick: () => void } | null;
};

export function WorkspaceHeader({
  surfaceLabel = "Build",
  backLabel,
  onBack,
  title,
  lifecycle,
  view,
  nextGate,
}: WorkspaceHeaderProps) {
  return (
    <header class="ws-header">
      <div class="ws-hero">
        <h1 class="ws-title">{surfaceLabel}</h1>
        <p class="ws-hero-stage mono">{VIEW_LABEL[view]}</p>
      </div>

      <div class="ws-context">
        <div class="ws-context-left">
          <button type="button" class="cta linkish ws-back" onClick={onBack}>
            ‹ {backLabel}
          </button>
          <span class="ws-context-goal" title={title}>
            {title}
          </span>
          <span
            class="ws-pill"
            data-lifecycle={lifecycleDataAttr(lifecycle)}
          >
            {lifecycle}
          </span>
        </div>
        {nextGate ? (
          <button type="button" class="cta" onClick={nextGate.onClick}>
            {nextGate.label}
          </button>
        ) : null}
      </div>
    </header>
  );
}
