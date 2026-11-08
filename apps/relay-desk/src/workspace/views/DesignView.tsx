import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { DeskSettings } from "../../gateway/types.ts";
import {
  lowerSpec,
  resolveSlot,
  validateSpec,
} from "../../spec/client.ts";
import {
  deriveSchematic,
  formatServiceDisplayName,
  slotBindingPlainLabel,
  type SchematicNode,
  type SchematicSlotSummary,
} from "../../spec/schematic.ts";
import { focusYamlLine, findYamlIssueLine } from "../../spec/yaml-focus.ts";
import type { SpecValidationIssue } from "../../spec/types.ts";
import {
  updateDraft,
  type DraftRecord,
} from "../../specs/draft-store.ts";
import { SchematicCanvas } from "../schematic/SchematicCanvas.tsx";
import { humanStepTitle } from "../schematic/flow-model.ts";
import type { SchematicActions } from "../schematic/schematic-actions.tsx";

export type DesignViewProps = {
  draft: DraftRecord;
  settings: DeskSettings;
  onDraftUpdated: (draft: DraftRecord) => void;
  onReDraft: () => void;
  /** Jump to YAML line when arriving from Verify (w7). */
  focusIssue?: Pick<SpecValidationIssue, "path" | "stepId" | "ruleId">;
  onFocusIssueConsumed?: () => void;
};

type CanvasMode = "schematic" | "manifest" | "yaml";

type SlotCandidateRow = {
  index: number;
  binding: string;
  status: string;
  service?: string;
  reason?: string;
  selected: boolean;
};

function orphanSlots(
  slots: SchematicSlotSummary[],
  steps: SchematicNode[]
): SchematicSlotSummary[] {
  const used = new Set(
    steps.map((s) => s.slotId).filter((id): id is string => Boolean(id))
  );
  return slots.filter((s) => !used.has(s.id));
}

function candidatesForSlot(
  body: Record<string, unknown> | undefined,
  slotId: string
): SlotCandidateRow[] {
  const raw = body?.slots;
  if (!Array.isArray(raw)) return [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const s = item as Record<string, unknown>;
    if (s.id !== slotId) continue;
    const preferred =
      typeof s.preferredCandidateIndex === "number"
        ? s.preferredCandidateIndex
        : undefined;
    const list = Array.isArray(s.candidates) ? s.candidates : [];
    return list.flatMap((c, index) => {
      if (!c || typeof c !== "object" || Array.isArray(c)) return [];
      const cand = c as Record<string, unknown>;
      if (typeof cand.binding !== "string" || typeof cand.status !== "string") {
        return [];
      }
      return [
        {
          index,
          binding: cand.binding,
          status: cand.status,
          service:
            typeof cand.service === "string" ? cand.service : undefined,
          reason: typeof cand.reason === "string" ? cand.reason : undefined,
          selected: preferred === index,
        },
      ];
    });
  }
  return [];
}

function candidatePlainLabel(c: SlotCandidateRow): string {
  if (c.binding === "human") return "You (HITL)";
  if (c.binding === "computer") return "Computer";
  if (c.binding === "browser") return "Browser";
  const svc = formatServiceDisplayName(c.service);
  if (svc) return `${svc} (${c.binding})`;
  return c.binding;
}

export function DesignView({
  draft,
  settings,
  onDraftUpdated,
  onReDraft,
  focusIssue,
  onFocusIssueConsumed,
}: DesignViewProps) {
  const [mode, setMode] = useState<CanvasMode>("schematic");
  const [yamlDraft, setYamlDraft] = useState(draft.yaml);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [bindingOpenId, setBindingOpenId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const [intentExpanded, setIntentExpanded] = useState(false);
  const [intentClamped, setIntentClamped] = useState(false);
  const [body, setBody] = useState<Record<string, unknown> | undefined>(
    draft.body
  );
  const [manifest, setManifest] = useState<Record<string, unknown> | undefined>(
    draft.manifest
  );
  const yamlRef = useRef<HTMLTextAreaElement>(null);
  const intentTextRef = useRef<HTMLParagraphElement>(null);
  const yamlDirty = yamlDraft !== draft.yaml;

  useEffect(() => {
    setYamlDraft(draft.yaml);
    setBody(draft.body);
    setManifest(draft.manifest);
    setIntentExpanded(false);
  }, [draft.id, draft.yaml, draft.body, draft.manifest]);

  useEffect(() => {
    const el = intentTextRef.current;
    if (!el || intentExpanded) {
      setIntentClamped(false);
      return;
    }
    const measure = () => {
      setIntentClamped(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [draft.intent, intentExpanded]);

  const refreshBody = useCallback(
    async (yaml: string) => {
      if (!yaml.trim()) return;
      setBusy(true);
      setError(undefined);
      try {
        const res = await validateSpec(settings, yaml);
        const nextBody = res.body ?? draft.body;
        setBody(nextBody);
        const updated = updateDraft(draft.id, {
          yaml,
          body: nextBody,
          goal:
            typeof nextBody?.goal === "string"
              ? nextBody.goal
              : draft.goal,
        });
        if (updated) onDraftUpdated(updated);
        if (!res.ok && res.validation?.errors?.[0]) {
          setError(
            res.validation.errors
              .slice(0, 2)
              .map((e) => e.message)
              .join(" · ")
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [settings, draft.id, draft.body, draft.goal, onDraftUpdated]
  );

  const onSaveYaml = useCallback(async () => {
    await refreshBody(yamlDraft);
  }, [refreshBody, yamlDraft]);

  const onCompileManifest = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await lowerSpec(settings, draft.yaml);
      if (!res.ok) {
        setError(res.error ?? "Compile failed");
        return;
      }
      setManifest(res.manifest);
      const updated = updateDraft(draft.id, {
        manifest: res.manifest,
      });
      if (updated) onDraftUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [settings, draft.yaml, draft.id, onDraftUpdated]);

  const schematic = useMemo(
    () => deriveSchematic({ body, manifest }),
    [body, manifest]
  );

  const selected =
    schematic.nodes.find((n) => n.id === selectedId) ??
    schematic.steps.find((n) => n.id === selectedId);

  const slotCandidates = useMemo(() => {
    if (!selected?.slotId) return [];
    return candidatesForSlot(body, selected.slotId);
  }, [body, selected?.slotId]);

  const jumpToStepYaml = useCallback(
    (stepId: string) => {
      setMode("yaml");
      const line = findYamlIssueLine(yamlDraft, { stepId });
      requestAnimationFrame(() => {
        focusYamlLine(yamlRef.current, yamlDraft, line);
      });
    },
    [yamlDraft]
  );

  const onPickCandidate = useCallback(
    async (slotId: string, candidateIndex: number) => {
      setBusy(true);
      setError(undefined);
      setNote(undefined);
      try {
        const res = await resolveSlot(settings, {
          body: body ?? draft.body,
          yaml: yamlDraft || draft.yaml,
          slotId,
          candidateIndex,
        });
        if (!res.ok) {
          setError(res.error ?? "Could not resolve binding");
          return;
        }
        if (res.body) setBody(res.body);
        if (res.yaml) setYamlDraft(res.yaml);
        const updated = updateDraft(draft.id, {
          yaml: res.yaml ?? draft.yaml,
          body: res.body ?? draft.body,
        });
        if (updated) onDraftUpdated(updated);
        setNote(res.note ?? "Binding updated — Spec law unchanged.");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [
      settings,
      body,
      draft.body,
      draft.yaml,
      draft.id,
      yamlDraft,
      onDraftUpdated,
    ]
  );

  useEffect(() => {
    if (!focusIssue) return;
    setMode("yaml");
    const line = findYamlIssueLine(yamlDraft, focusIssue);
    requestAnimationFrame(() => {
      focusYamlLine(yamlRef.current, yamlDraft, line);
      onFocusIssueConsumed?.();
    });
  }, [focusIssue, yamlDraft, onFocusIssueConsumed]);

  const orphans = orphanSlots(schematic.slots, schematic.steps);

  const canvasActions = useMemo<SchematicActions>(
    () => ({
      busy,
      bindingOpenId,
      setBindingOpenId,
      getCandidates: (slotId) =>
        candidatesForSlot(body, slotId).map((c) => ({
          index: c.index,
          label: candidatePlainLabel(c),
          status: c.status,
          reason: c.reason,
          selected: c.selected,
        })),
      onPickCandidate: (slotId, candidateIndex) => {
        void onPickCandidate(slotId, candidateIndex);
      },
      onJumpToYaml: jumpToStepYaml,
      onSelectStep: setSelectedId,
    }),
    [busy, bindingOpenId, body, onPickCandidate, jumpToStepYaml]
  );

  const inspector = (
    <aside class="sch-inspector" aria-label="Step inspector">
      <p class="tile-label">Step inspector</p>
      {selected ? (
        <>
          <h2 class="tile-title">{humanStepTitle(selected)}</h2>
          {selected.slot ? (
            <>
              <p class="tile-meta">{slotBindingPlainLabel(selected.slot)}</p>
              <p class="tile-meta">
                slot · <span class="mono">{selected.slot.id}</span>
              </p>
              <p class="tile-meta muted">
                Binding swaps without rewriting the Spec.
              </p>
              {slotCandidates.length > 0 ? (
                <div class="sch-bind-picker" role="list">
                  <p class="tile-label">Binding</p>
                  {slotCandidates.map((c) => {
                    const blocked = c.status === "blocked";
                    const degraded = c.status === "degraded";
                    return (
                      <button
                        key={c.index}
                        type="button"
                        class="sch-bind-option"
                        role="listitem"
                        data-selected={c.selected ? "1" : "0"}
                        data-degraded={degraded ? "1" : "0"}
                        disabled={busy || blocked}
                        title={
                          blocked
                            ? c.reason ?? "Blocked"
                            : c.reason ?? candidatePlainLabel(c)
                        }
                        onClick={() =>
                          void onPickCandidate(selected.slotId!, c.index)
                        }
                      >
                        <span>{candidatePlainLabel(c)}</span>
                        <span class="mono muted">
                          {c.selected
                            ? "selected"
                            : degraded
                              ? "degraded"
                              : c.status}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : null}
          {selected.use ? <p class="mono muted">{selected.use}</p> : null}
          {selected.forEach ? (
            <p class="tile-meta">
              forEach · <span class="mono">{selected.forEach}</span>
            </p>
          ) : null}
          {selected.once ? (
            <p class="tile-meta">
              once · <span class="mono">{selected.once}</span>
            </p>
          ) : null}
          {selected.enforce.length ? (
            <p class="tile-meta">
              enforce ·{" "}
              <span class="mono">{selected.enforce.join(", ")}</span>
            </p>
          ) : null}
          {selected.kind === "step" || selected.kind === "hitl" ? (
            <button
              type="button"
              class="cta linkish"
              onClick={() => jumpToStepYaml(selected.id)}
            >
              Jump to YAML
            </button>
          ) : null}
        </>
      ) : (
        <>
          <p class="tile-meta">
            Select a step · binding swaps without rewriting the Spec.
          </p>
          <p class="tile-meta mono muted">YAML remains source of truth</p>
        </>
      )}
    </aside>
  );

  const canvasFooter = (
    <div class="sch-canvas-meta">
      {orphans.length ? (
        <div class="sch-slots" aria-label="Unused capability slots">
          <span class="tile-label">Other capabilities</span>
          <div class="sch-slots-chips">
            {orphans.map((s) => (
              <span
                key={s.id}
                class="sch-badge"
                data-kind="slot"
                data-slot-state={s.state}
                data-degraded={s.degraded ? "1" : undefined}
                title={`${s.id}${s.reason ? ` — ${s.reason}` : ""}`}
              >
                {slotBindingPlainLabel(s)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {schematic.rules.length ? (
        <div class="sch-rules" aria-label="Rules">
          <span class="tile-label">Rules</span>
          <div class="sch-rules-chips">
            {schematic.rules.map((r) => (
              <span key={r.id} class="sch-rule-chip mono">
                {r.id}
                <span class="muted"> · {r.kind}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <p class="sch-footer mono">
        Read-only schematic · bindings are swappable · Spec law stays
      </p>
    </div>
  );

  return (
    <div class="design-view">
      <div class="design-intent">
        <div class="design-intent-row">
          <p class="tile-label">Your intent</p>
          <div class="design-intent-actions">
            {intentClamped || intentExpanded ? (
              <button
                type="button"
                class="design-intent-expand"
                aria-expanded={intentExpanded}
                aria-label={
                  intentExpanded ? "Collapse intent" : "Expand intent"
                }
                title={intentExpanded ? "Collapse" : "Show full intent"}
                onClick={() => setIntentExpanded((v) => !v)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  {intentExpanded ? (
                    <path
                      d="M4 10.5 8 6.5l4 4"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  ) : (
                    <path
                      d="M4 6.5 8 10.5l4-4"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  )}
                </svg>
              </button>
            ) : null}
            <button
              type="button"
              class="cta ghost design-redraft"
              disabled={busy}
              onClick={onReDraft}
            >
              Re-draft
            </button>
          </div>
        </div>
        <p
          ref={intentTextRef}
          class="design-intent-text"
          data-expanded={intentExpanded ? "1" : "0"}
        >
          {draft.intent || "—"}
        </p>
      </div>

      <div class="design-toolbar">
        <p class="tile-label">Flow</p>
        <div class="design-mode" role="tablist" aria-label="Design surface">
          {(
            [
              ["schematic", "Schematic"],
              ["manifest", "Manifest"],
              ["yaml", "YAML"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              class="design-mode-btn"
              data-active={mode === id ? "1" : "0"}
              aria-selected={mode === id}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div class="cta-row design-toolbar-actions">
          {mode === "yaml" && yamlDirty ? (
            <button
              type="button"
              class="cta"
              disabled={busy}
              onClick={() => void onSaveYaml()}
            >
              {busy ? "Saving…" : "Save YAML"}
            </button>
          ) : null}
          {mode === "manifest" && !manifest ? (
            <button
              type="button"
              class="cta"
              disabled={busy || !draft.yaml.trim()}
              onClick={() => void onCompileManifest()}
            >
              {busy ? "Compiling…" : "Compile"}
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p class="error design-error">{error}</p> : null}
      {note ? <p class="hint mono design-note">{note}</p> : null}

      <div class="design-main" data-mode={mode}>
        {mode === "schematic" ? (
          schematic.nodes.length ? (
            <SchematicCanvas
              model={schematic}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                if (bindingOpenId && bindingOpenId !== id) {
                  setBindingOpenId(undefined);
                }
              }}
              inspector={inspector}
              footer={canvasFooter}
              actions={canvasActions}
            />
          ) : (
            <div class="sch-viewport sch-viewport-empty">
              <p class="tile-meta">
                {busy
                  ? "Reading Spec…"
                  : "No steps yet — save YAML or create a draft."}
              </p>
            </div>
          )
        ) : null}

        {mode === "manifest" ? (
          <div class="design-manifest">
            {manifest ? (
              <pre class="spec-pre sch-pre">
                {JSON.stringify(manifest, null, 2)}
              </pre>
            ) : (
              <p class="tile-meta">
                Compile the Spec to see what it becomes. YAML stays the source of
                truth.
              </p>
            )}
          </div>
        ) : null}

        {mode === "yaml" ? (
          <div class="design-yaml" data-spec-step="yaml">
            <textarea
              ref={yamlRef}
              class="spec-textarea mono design-yaml-editor"
              value={yamlDraft}
              spellcheck={false}
              disabled={busy}
              onInput={(e) =>
                setYamlDraft((e.target as HTMLTextAreaElement).value)
              }
            />
            {yamlDirty ? (
              <p class="hint mono design-yaml-hint">
                Unsaved — Save YAML to refresh the schematic
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
