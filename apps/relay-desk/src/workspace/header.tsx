import type { LifecyclePill, WorkspaceView } from "./journey.ts";
import { VIEW_LABEL, lifecycleDataAttr } from "./journey.ts";

export type WorkspaceHeaderProps = {
  backLabel: string;
  onBack: () => void;
  title: string;
  lifecycle: LifecyclePill;
  specHash?: string;
  trigger?: string;
  view: WorkspaceView;
  nextGate?: { label: string; onClick: () => void } | null;
};

export function WorkspaceHeader({
  backLabel,
  onBack,
  title,
  lifecycle,
  specHash,
  trigger,
  view,
  nextGate,
}: WorkspaceHeaderProps) {
  return (
    <header class="ws-header">
      <div class="ws-header-top">
        <button type="button" class="cta linkish ws-back" onClick={onBack}>
          ← {backLabel}
        </button>
        {nextGate ? (
          <button type="button" class="cta" onClick={nextGate.onClick}>
            {nextGate.label}
          </button>
        ) : null}
      </div>
      <div class="ws-header-main">
        <div class="ws-header-titles">
          <h1 class="ws-title">{title}</h1>
          <p class="ws-sub">
            <span class="ws-pill" data-lifecycle={lifecycleDataAttr(lifecycle)}>
              {lifecycle}
            </span>
            <span class="ws-stage mono">{VIEW_LABEL[view]}</span>
            {trigger ? <span class="mono muted">{trigger}</span> : null}
            {specHash ? (
              <span class="mono muted" title={specHash}>
                {specHash.length > 12 ? `${specHash.slice(0, 12)}…` : specHash}
              </span>
            ) : null}
          </p>
        </div>
      </div>
    </header>
  );
}
