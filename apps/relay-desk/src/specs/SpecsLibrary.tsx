import { useCallback, useState } from "preact/hooks";
import type { DeskRoute } from "../workspace/routes.ts";
import {
  createDraftFromYaml,
  deleteDraft,
  loadDrafts,
  type DraftRecord,
} from "./draft-store.ts";
import {
  formatUpdatedAt,
  toLibraryItems,
  type LibraryItem,
} from "./library.ts";

export type SpecsLibraryProps = {
  onNavigate: (route: DeskRoute) => void;
};

export function SpecsLibrary({ onNavigate }: SpecsLibraryProps) {
  const [items, setItems] = useState<LibraryItem[]>(() =>
    toLibraryItems(loadDrafts())
  );
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteYaml, setPasteYaml] = useState("");
  const [pasteError, setPasteError] = useState<string | undefined>();

  const refresh = useCallback(() => {
    setItems(toLibraryItems(loadDrafts()));
  }, []);

  const openItem = useCallback(
    (item: LibraryItem) => {
      onNavigate({
        kind: "build-workspace",
        draftId: item.draft.id,
        view: item.action.view,
      });
    },
    [onNavigate]
  );

  const onPasteCreate = useCallback(() => {
    const yaml = pasteYaml.trim();
    if (!yaml) {
      setPasteError("Paste a Spec YAML first");
      return;
    }
    if (!/^\s*goal\s*:/m.test(yaml) && !/^\s*version\s*:/m.test(yaml)) {
      setPasteError("That doesn’t look like a Spec — expect a goal or version field");
      return;
    }
    setPasteError(undefined);
    const draft = createDraftFromYaml(yaml);
    refresh();
    setPasteYaml("");
    setPasteOpen(false);
    onNavigate({
      kind: "build-workspace",
      draftId: draft.id,
      view: "design",
    });
  }, [pasteYaml, onNavigate, refresh]);

  const onRemove = useCallback(
    (draft: DraftRecord, e: Event) => {
      e.stopPropagation();
      deleteDraft(draft.id);
      refresh();
    },
    [refresh]
  );

  return (
    <div class="desk-body build-library">
      <div class="console-head library-head">
        <div class="library-head-text">
          <h1 class="console-title">Build</h1>
          <p class="console-sub">In progress · drafts live on this Desk</p>
        </div>
        <button
          type="button"
          class="cta"
          onClick={() => onNavigate({ kind: "build-new" })}
        >
          + New spec
        </button>
      </div>

      {items.length === 0 ? (
        <section class="tile library-empty">
          <div class="tile-stack">
            <p class="tile-label">No drafts yet</p>
            <h2 class="tile-title">Start from an intent</h2>
            <p class="tile-meta">
              Create a draft, run checks, then ship. Approved apps live under
              Apps — not here.
            </p>
            <div class="cta-row">
              <button
                type="button"
                class="cta"
                onClick={() => onNavigate({ kind: "build-new" })}
              >
                + New spec
              </button>
            </div>
          </div>
        </section>
      ) : (
        <ul class="library-list" aria-label="Drafts">
          {items.map((item) => (
            <li key={item.draft.id} class="library-row">
              <button
                type="button"
                class="library-row-main"
                onClick={() => openItem(item)}
              >
                <span class="library-row-title">{item.draft.goal}</span>
                <span class="library-row-state">{item.statePhrase}</span>
                <span class="library-row-meta mono">
                  {formatUpdatedAt(item.draft.updatedAt)}
                  {item.draft.mode ? ` · ${item.draft.mode}` : ""}
                </span>
              </button>
              <div class="library-row-actions">
                <button
                  type="button"
                  class="cta"
                  onClick={() => openItem(item)}
                >
                  {item.action.label}
                </button>
                <button
                  type="button"
                  class="cta linkish"
                  title="Remove from this Desk"
                  onClick={(e) => onRemove(item.draft, e)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer class="library-footer">
        <button
          type="button"
          class="cta linkish"
          aria-expanded={pasteOpen}
          onClick={() => setPasteOpen((o) => !o)}
        >
          {pasteOpen ? "Hide paste YAML" : "Paste YAML"}
        </button>
        <p class="tile-meta library-footer-note">
          Install a frozen bundle from Apps. Drafts are stored on this Desk only.
        </p>
      </footer>

      {pasteOpen ? (
        <section class="tile library-paste">
          <div class="tile-stack">
            <p class="tile-label">Paste Spec YAML</p>
            <p class="tile-meta">
              Creates a local draft and opens Design. Does not install an app.
            </p>
            <textarea
              class="spec-yaml"
              rows={10}
              value={pasteYaml}
              placeholder={"goal: …\nversion: 2\n…"}
              onInput={(e) =>
                setPasteYaml((e.target as HTMLTextAreaElement).value)
              }
            />
            {pasteError ? <p class="error">{pasteError}</p> : null}
            <div class="cta-row">
              <button type="button" class="cta" onClick={onPasteCreate}>
                Create draft
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
