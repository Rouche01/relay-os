import type { DraftRecord } from "./draft-store.ts";
import {
  actionForLifecycle,
  lifecycleFromDraft,
  statePhraseForLifecycle,
  type LibraryRowAction,
} from "../workspace/journey.ts";

export type LibraryItem = {
  draft: DraftRecord;
  /** Plain-language state for the row. */
  statePhrase: string;
  action: LibraryRowAction;
};

export function toLibraryItems(drafts: DraftRecord[]): LibraryItem[] {
  return drafts.map((draft) => {
    const lifecycle = lifecycleFromDraft(draft);
    return {
      draft,
      statePhrase: statePhraseForLifecycle(lifecycle),
      action: actionForLifecycle(lifecycle),
    };
  });
}

export function formatUpdatedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
