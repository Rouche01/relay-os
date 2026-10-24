import { useState } from "preact/hooks";
import { createSpec, type SpecBundleDto } from "../api/specs.ts";

type Props = {
  onClose: () => void;
  onCreated: (created: SpecBundleDto) => void;
};

export function NewIntentModal({ onClose, onCreated }: Props) {
  const [goal, setGoal] = useState(
    "Scout Reddit and draft replies, then post after approval"
  );
  const [maxJobs, setMaxJobs] = useState(2);
  const [dryRun, setDryRun] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = await createSpec({
        goal: goal.trim(),
        slots: { maxJobs, dryRun },
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="modal" role="dialog" aria-label="New from Intent">
        <h2>New from Intent</h2>
        <label for="goal">Goal</label>
        <textarea
          id="goal"
          value={goal}
          onInput={(e) => setGoal((e.target as HTMLTextAreaElement).value)}
        />
        <label for="maxJobs">maxJobs</label>
        <input
          id="maxJobs"
          type="number"
          min={0}
          value={maxJobs}
          onInput={(e) =>
            setMaxJobs(Number((e.target as HTMLInputElement).value) || 0)
          }
        />
        <label class="check">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) =>
              setDryRun((e.target as HTMLInputElement).checked)
            }
          />{" "}
          dryRun
        </label>
        <p class="hint">
          Decide picks catalog primitives for this goal, then compose drafts a
          Spec (<code>relay/primitives</code>). Domain packs / CE manifests stay
          in their apps. Set <code>DECIDE_BACKEND=jev</code> for Jev.
        </p>
        <div class="modal-actions">
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy || !goal.trim()}
            onClick={() => void submit()}
          >
            {busy ? "Composing…" : "Compose Spec"}
          </button>
          <button type="button" class="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
        {error ? <p class="flash err">{error}</p> : null}
      </div>
    </div>
  );
}
