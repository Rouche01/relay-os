import type { DraftRecord, DraftStatus } from "./draft-store.ts";
import type { WorkspaceView } from "../workspace/journey.ts";

export type LibraryRowAction = {
  label: string;
  view: WorkspaceView;
};

export type LibraryItem = {
  draft: DraftRecord;
  /** Plain-language state for the row. */
  statePhrase: string;
  action: LibraryRowAction;
};

export function statePhraseFor(status: DraftStatus): string {
  switch (status) {
    case "draft":
      return "Draft · not checked yet";
    case "checks_passed":
      return "Checks passed · not frozen";
    case "frozen":
      return "Frozen · not on Apps yet";
    case "needs_catalog":
      return "Needs catalog · connection or descriptor";
  }
}

export function actionFor(status: DraftStatus): LibraryRowAction {
  switch (status) {
    case "draft":
      return { label: "Open design", view: "design" };
    case "checks_passed":
      return { label: "Finish setup", view: "ship" };
    case "frozen":
      return { label: "Finish setup", view: "ship" };
    case "needs_catalog":
      return { label: "See what's missing", view: "design" };
  }
}

export function toLibraryItems(drafts: DraftRecord[]): LibraryItem[] {
  return drafts.map((draft) => ({
    draft,
    statePhrase: statePhraseFor(draft.status),
    action: actionFor(draft.status),
  }));
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
