import { useCallback, useEffect, useState } from "preact/hooks";
import {
  getDraft,
  updateDraft,
  type DraftRecord,
} from "../specs/draft-store.ts";

/**
 * Shared draft handle for Design · Verify · Ship · Activity.
 * Source of truth is the Desk-local draft store (localStorage); this hook
 * keeps an in-memory copy aligned across journey navigation and reloads.
 */
export function useWorkspaceDraft(
  draftId: string | undefined,
  external?: DraftRecord
): {
  draft: DraftRecord | undefined;
  patchDraft: (patch: Partial<Omit<DraftRecord, "id">>) => DraftRecord | undefined;
  refreshDraft: () => void;
  adoptDraft: (next: DraftRecord) => void;
} {
  const [draft, setDraft] = useState<DraftRecord | undefined>(() => {
    if (external) return external;
    return draftId ? getDraft(draftId) : undefined;
  });

  const refreshDraft = useCallback(() => {
    if (!draftId) {
      setDraft(undefined);
      return;
    }
    setDraft(getDraft(draftId) ?? external);
  }, [draftId, external]);

  useEffect(() => {
    refreshDraft();
  }, [refreshDraft]);

  useEffect(() => {
    if (external && external.id === draftId) {
      setDraft(external);
    }
  }, [external, draftId]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "relay-desk.build-drafts") refreshDraft();
    };
    const onFocus = () => refreshDraft();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshDraft]);

  const patchDraft = useCallback(
    (patch: Partial<Omit<DraftRecord, "id">>) => {
      if (!draftId) return undefined;
      const next = updateDraft(draftId, patch);
      if (next) setDraft(next);
      return next;
    },
    [draftId]
  );

  const adoptDraft = useCallback((next: DraftRecord) => {
    setDraft(next);
  }, []);

  return { draft, patchDraft, refreshDraft, adoptDraft };
}
