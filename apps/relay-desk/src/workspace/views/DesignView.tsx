import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { DeskSettings } from "../../gateway/types.ts";
import { lowerSpec, validateSpec } from "../../spec/client.ts";
import {
  deriveSchematic,
  type SchematicBadge,
  type SchematicNode,
} from "../../spec/schematic.ts";
import { focusYamlLine, findYamlIssueLine } from "../../spec/yaml-focus.ts";
import type { SpecValidationIssue } from "../../spec/types.ts";
import {
  updateDraft,
  type DraftRecord,
} from "../../specs/draft-store.ts";

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

function badgeLabel(b: SchematicBadge): string {
  switch (b.kind) {
    case "forEach":
      return `×N · ${b.itemsRef}`;
    case "once":
      return `once · ${b.key}`;
    case "when":
      return `when · ${b.summary}`;
    case "retry":
      return `retry ×${b.max}`;
    case "irreversible":
      return "irreversible";
    case "hitl":
      return "HITL";
  }
}

function NodeCard({
  node,
  selected,
  onSelect,
}: {
  node: SchematicNode;
  selected: boolean;
  onSelect: () => void;
}) {
  const shape =
    node.kind === "hitl"
      ? "diamond"
      : node.kind === "trigger"
        ? "trigger"
        : "step";
  return (
    <button
      type="button"
      class="sch-node"
      data-kind={shape}
      data-selected={selected ? "1" : "0"}
      data-irreversible={node.irreversible ? "1" : "0"}
      onClick={onSelect}
    >
      <span class="sch-node-label">{node.label}</span>
      {node.use ? <span class="sch-node-use mono">{node.use}</span> : null}
      {node.service || node.operation ? (
        <span class="sch-node-svc mono">
          {[node.service, node.operation].filter(Boolean).join(" · ")}
        </span>
      ) : null}
      {node.badges.length ? (
        <span class="sch-badges">
          {node.badges.map((b) => (
            <span
              key={b.kind + badgeLabel(b)}
              class="sch-badge"
              data-kind={b.kind}
            >
              {badgeLabel(b)}
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [body, setBody] = useState<Record<string, unknown> | undefined>(
    draft.body
  );
  const [manifest, setManifest] = useState<Record<string, unknown> | undefined>(
    draft.manifest
  );
  const yamlRef = useRef<HTMLTextAreaElement>(null);
  const yamlDirty = yamlDraft !== draft.yaml;

  useEffect(() => {
    setYamlDraft(draft.yaml);
    setBody(draft.body);
    setManifest(draft.manifest);
  }, [draft.id, draft.yaml, draft.body, draft.manifest]);

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

  useEffect(() => {
    if (!body && draft.yaml.trim()) {
      void refreshBody(draft.yaml);
    }
  }, [draft.id]);

  useEffect(() => {
    if (!focusIssue) return;
    setMode("yaml");
    const line = findYamlIssueLine(yamlDraft, focusIssue);
    requestAnimationFrame(() => {
      focusYamlLine(yamlRef.current, yamlDraft, line);
      onFocusIssueConsumed?.();
    });
  }, [focusIssue, yamlDraft, onFocusIssueConsumed]);

  const schematic = useMemo(
    () => deriveSchematic({ body, manifest }),
    [body, manifest]
  );

  const selected =
    schematic.nodes.find((n) => n.id === selectedId) ??
    schematic.steps.find((n) => n.id === selectedId);

  const onSaveYaml = useCallback(async () => {
    await refreshBody(yamlDraft);
  }, [refreshBody, yamlDraft]);

  const onCompileManifest = useCallback(async () => {
    const yaml = yamlDirty ? yamlDraft : draft.yaml;
    setBusy(true);
    setError(undefined);
    try {
      if (yamlDirty) await refreshBody(yaml);
      const res = await lowerSpec(settings, yaml);
      if (!res.ok || !res.manifest) {
        throw new Error(res.error || "Lower failed");
      }
      setManifest(res.manifest);
      const updated = updateDraft(draft.id, {
        yaml,
        manifest: res.manifest,
        body: body ?? draft.body,
      });
      if (updated) onDraftUpdated(updated);
      setMode("manifest");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [
    yamlDirty,
    yamlDraft,
    draft.yaml,
    draft.id,
    draft.body,
    body,
    settings,
    refreshBody,
    onDraftUpdated,
  ]);

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

  return (
    <div class="design-view">
      <section class="design-intent tile">
        <div class="tile-stack">
          <div class="tile-head">
            <p class="tile-label">Intent</p>
            <button
              type="button"
              class="cta linkish"
              disabled={busy}
              onClick={onReDraft}
            >
              Re-draft
            </button>
          </div>
          <p class="design-intent-text">{draft.intent || "—"}</p>
        </div>
      </section>

      <div class="design-toolbar">
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
        <div class="cta-row">
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

      <div class="design-main" data-mode={mode}>
        {mode === "schematic" ? (
          <div class="design-split">
            <div class="sch-canvas" aria-label="Schematic">
              {schematic.trigger ? (
                <NodeCard
                  node={schematic.trigger}
                  selected={selectedId === schematic.trigger.id}
                  onSelect={() => setSelectedId(schematic.trigger!.id)}
                />
              ) : null}
              {schematic.steps.map((step, i) => (
                <div key={step.id} class="sch-flow">
                  {i > 0 || schematic.trigger ? (
                    <span class="sch-edge" aria-hidden="true">
                      ↓
                      {step.forEach ? (
                        <span class="sch-edge-ref mono">{step.forEach}</span>
                      ) : null}
                    </span>
                  ) : null}
                  <NodeCard
                    node={step}
                    selected={selectedId === step.id}
                    onSelect={() => setSelectedId(step.id)}
                  />
                </div>
              ))}
              {schematic.rules.length ? (
                <div class="sch-rules" aria-label="Rules">
                  <p class="tile-label">Rules</p>
                  <ul class="sch-rules-list">
                    {schematic.rules.map((r) => (
                      <li key={r.id}>
                        <span class="mono">{r.id}</span>
                        <span class="muted"> · {r.kind}</span>
                        {r.enforcedBy.length ? (
                          <span class="mono muted">
                            {" "}
                            · {r.enforcedBy.join(", ")}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {!schematic.nodes.length ? (
                <p class="tile-meta">
                  {busy
                    ? "Reading Spec…"
                    : "No steps yet — save YAML or create a draft."}
                </p>
              ) : null}
            </div>
            <aside class="sch-inspector tile" aria-label="Inspector">
              <div class="tile-stack">
                <p class="tile-label">Inspector</p>
                {selected ? (
                  <>
                    <h2 class="tile-title">{selected.label}</h2>
                    {selected.use ? (
                      <p class="mono muted">{selected.use}</p>
                    ) : null}
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
                    {selected.outputs.length ? (
                      <p class="tile-meta">
                        outputs ·{" "}
                        <span class="mono">{selected.outputs.join(", ")}</span>
                      </p>
                    ) : null}
                    {selected.schema ? (
                      <pre class="spec-pre sch-pre">
                        {JSON.stringify(selected.schema, null, 2)}
                      </pre>
                    ) : null}
                    {selected.args && Object.keys(selected.args).length ? (
                      <pre class="spec-pre sch-pre">
                        {JSON.stringify(selected.args, null, 2)}
                      </pre>
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
                  <p class="tile-meta">Select a node</p>
                )}
              </div>
            </aside>
          </div>
        ) : null}

        {mode === "manifest" ? (
          <div class="design-manifest tile">
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
          <div class="design-yaml tile" data-spec-step="yaml">
            <textarea
              ref={yamlRef}
              class="spec-textarea mono design-yaml-editor"
              rows={22}
              value={yamlDraft}
              spellcheck={false}
              disabled={busy}
              onInput={(e) =>
                setYamlDraft((e.target as HTMLTextAreaElement).value)
              }
            />
            {yamlDirty ? (
              <p class="hint mono">Unsaved — Save YAML to refresh the schematic</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
