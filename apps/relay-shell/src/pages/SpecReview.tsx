import { useEffect, useState } from "preact/hooks";
import {
  abortSpec,
  approveSpec,
  getSpec,
  packIdOf,
  partitionActions,
  takeCreateFlash,
  type SpecBundleDto,
} from "../api/specs.ts";

type Props = { id: string };

export function SpecReview({ id }: Props) {
  const [bundle, setBundle] = useState<SpecBundleDto | null>(null);
  const [flash, setFlash] = useState<{ text: string; err?: boolean } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [decideNote, setDecideNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const createFlash = takeCreateFlash(id);
    void (async () => {
      try {
        const b = await getSpec(id);
        if (!cancelled) {
          setBundle(b);
          if (createFlash) {
            const ids =
              createFlash.primitiveIds.length > 0
                ? createFlash.primitiveIds.join(", ")
                : partitionActions(b).primitives.join(", ");
            const backend = createFlash.decideBackend
              ? ` via ${createFlash.decideBackend}`
              : "";
            setDecideNote(`Composed primitives${backend}: ${ids || "—"}`);
            setFlash({
              text: `Draft ready · ${createFlash.packId ?? packIdOf(b)}`,
            });
          } else {
            setFlash(null);
            setDecideNote(null);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setFlash({
            err: true,
            text: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!bundle && !flash?.err) {
    return <p class="empty">Loading…</p>;
  }
  if (!bundle) {
    return (
      <section>
        <p class="flash err">{flash?.text}</p>
        <a class="linkish" href="#/">
          ← Specs
        </a>
      </section>
    );
  }

  const { primitives, aliases } = partitionActions(bundle);
  const constraints = bundle.spec.constraints
    .filter((c) => c.id !== "compose_pack")
    .map((c) => c.id)
    .join(", ");
  const canApprove =
    bundle.spec.status === "draft" || bundle.spec.status === "frozen";
  const canAbort =
    bundle.spec.status !== "aborted" && bundle.spec.status !== "satisfied";

  async function onApprove() {
    setBusy(true);
    try {
      const next = await approveSpec(bundle!.id);
      setBundle(next);
      setFlash({ text: `Approved · status ${next.spec.status}` });
    } catch (err) {
      setFlash({
        err: true,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onAbort() {
    setBusy(true);
    try {
      const next = await abortSpec(bundle!.id);
      setBundle(next);
      setFlash({ text: `Aborted · status ${next.spec.status}` });
    } catch (err) {
      setFlash({
        err: true,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <p class="eyebrow">Spec review</p>
      <h1>{bundle.spec.goal}</h1>
      <p class="lede">
        Freeze authority for this run. Approve to continue; Abort cancels.
      </p>
      {flash ? (
        <p class={`flash${flash.err ? " err" : ""}`}>{flash.text}</p>
      ) : null}
      {decideNote ? <p class="hint decide-note">{decideNote}</p> : null}

      <div class="panel">
        <h2>Spec summary</h2>
        <dl class="dl">
          <dt>Intent</dt>
          <dd>{bundle.intent.goal || "—"}</dd>
          <dt>Procedure</dt>
          <dd>
            {bundle.spec.procedure.appId}/{bundle.spec.procedure.entrypoint}
          </dd>
          <dt>Pack</dt>
          <dd>{packIdOf(bundle)}</dd>
          <dt>Status</dt>
          <dd>
            {bundle.spec.status} · v{bundle.spec.version}
          </dd>
          <dt>Constraints</dt>
          <dd>{constraints || "—"}</dd>
          <dt>Budget</dt>
          <dd>
            dryRun {String(bundle.spec.budget.dryRun ?? "—")}, maxJobs{" "}
            {bundle.spec.budget.maxJobs ?? "—"}
          </dd>
        </dl>
      </div>

      <div class="panel">
        <h2>Goal-aligned primitives</h2>
        <p class="hint vocab-lede">
          Catalog subset for this Spec (not the full fixed pack). Aliases appear
          only when a domain pack added them.
        </p>
        {primitives.length ? (
          <ul class="prim-chips">
            {primitives.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : (
          <p class="empty">No primitives on this Spec.</p>
        )}
        <div class="vocab">
          <div>
            <h3>Aliases</h3>
            <ul>
              {aliases.length
                ? aliases.map((a) => <li key={a}>{a}</li>)
                : [<li key="empty">—</li>]}
            </ul>
          </div>
        </div>
      </div>

      <div class="actions">
        <button
          type="button"
          class="btn btn-primary"
          disabled={!canApprove || busy}
          onClick={() => void onApprove()}
        >
          Approve Spec
        </button>
        <button
          type="button"
          class="btn"
          disabled={!canAbort || busy}
          onClick={() => void onAbort()}
        >
          Abort
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          disabled
          title="Edit Spec later"
        >
          Edit…
        </button>
        <a class="linkish back" href="#/">
          ← Specs
        </a>
      </div>
    </section>
  );
}
