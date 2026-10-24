import { useEffect, useState } from "preact/hooks";
import {
  listSpecs,
  packIdOf,
  partitionActions,
  stashCreateFlash,
  type SpecBundleDto,
} from "../api/specs.ts";
import { NewIntentModal } from "../components/NewIntentModal.tsx";

export function SpecsList() {
  const [records, setRecords] = useState<SpecBundleDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    try {
      const data = await listSpecs();
      setRecords(data.records);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRecords([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section>
      <div class="list-head">
        <div>
          <p class="eyebrow">Governance</p>
          <h1>Specs</h1>
          <p class="lede">
            Free-form goal → decide primitives → draft Spec → Approve / Abort.
          </p>
        </div>
        <button
          type="button"
          class="linkish"
          onClick={() => setShowNew(true)}
        >
          New from Intent
        </button>
      </div>

      {error ? (
        <p class="flash err">
          {error}
          <br />
          <span class="hint">
            Start API: <code>pnpm --filter @relay/apps-relay-shell api</code>
          </span>
        </p>
      ) : null}

      {records === null ? (
        <p class="empty">Loading…</p>
      ) : records.length === 0 ? (
        <p class="empty">No Specs yet. Create one from Intent.</p>
      ) : (
        <div class="spec-list">
          {records.map((b) => {
            const { primitives } = partitionActions(b);
            return (
              <a
                key={b.id}
                class="spec-row"
                href={`#/spec/${encodeURIComponent(b.id)}`}
              >
                <div>
                  <p class="goal">{b.spec.goal || "(no goal)"}</p>
                  <p class="pack">{packIdOf(b)}</p>
                  {primitives.length ? (
                    <p class="prim-preview">{primitives.join(" · ")}</p>
                  ) : null}
                </div>
                <div class="meta">
                  <span class="status">{b.spec.status}</span>
                  <span>
                    dryRun{" "}
                    {b.spec.budget.dryRun === undefined
                      ? "—"
                      : String(b.spec.budget.dryRun)}
                  </span>
                  <span>maxJobs {b.spec.budget.maxJobs ?? "—"}</span>
                  <span class="chev">›</span>
                </div>
              </a>
            );
          })}
        </div>
      )}

      {showNew ? (
        <NewIntentModal
          onClose={() => setShowNew(false)}
          onCreated={(created) => {
            stashCreateFlash(created);
            setShowNew(false);
            location.hash = `#/spec/${encodeURIComponent(created.id)}`;
          }}
        />
      ) : null}
    </section>
  );
}
