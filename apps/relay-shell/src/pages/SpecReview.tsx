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
import { explainSpec } from "../lib/spec-explain.ts";

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
  const explain = explainSpec(bundle);
  const constraints = bundle.spec.constraints.filter(
    (c) => c.id !== "compose_pack"
  );
  const hitl = bundle.spec.hitlRequired ?? [];
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
      <p class="lede explain-headline">{explain.headline}</p>
      {flash ? (
        <p class={`flash${flash.err ? " err" : ""}`}>{flash.text}</p>
      ) : null}
      {decideNote ? <p class="hint decide-note">{decideNote}</p> : null}

      <div class="panel">
        <h2>What it may do</h2>
        <p class="hint vocab-lede">
          Intended capability flow for this goal (not a runnable stage graph —
          CE manifests still own real engage runs).
        </p>
        {explain.flow.length ? (
          <ol class="flow-list">
            {explain.flow.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : (
          <p class="empty">No allowed actions.</p>
        )}
        {explain.caveats.length ? (
          <ul class="caveat-list">
            {explain.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div class="panel">
        <h2>Allowed actions</h2>
        <table class="spec-table">
          <thead>
            <tr>
              <th>Id</th>
              <th>Means</th>
              <th>Side effect</th>
            </tr>
          </thead>
          <tbody>
            {bundle.spec.allowedActions.map((a) => (
              <tr key={a.id}>
                <td>
                  <code>{a.id}</code>
                </td>
                <td>{a.description || "—"}</td>
                <td>{a.sideEffect || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {aliases.length ? (
          <p class="hint">
            Includes domain aliases: {aliases.join(", ")}
          </p>
        ) : null}
      </div>

      <div class="panel">
        <h2>Constraints & budget</h2>
        <dl class="dl">
          <dt>Pack</dt>
          <dd>{packIdOf(bundle)}</dd>
          <dt>Status</dt>
          <dd>
            {bundle.spec.status} · v{bundle.spec.version}
          </dd>
          <dt>Binding</dt>
          <dd>{bundle.spec.actionBinding}</dd>
          <dt>Budget</dt>
          <dd>
            dryRun {String(bundle.spec.budget.dryRun ?? "—")}, maxJobs{" "}
            {bundle.spec.budget.maxJobs ?? "—"}
          </dd>
          <dt>Procedure</dt>
          <dd>
            {bundle.spec.procedure.appId}/{bundle.spec.procedure.entrypoint}
          </dd>
        </dl>
        {constraints.length ? (
          <ul class="detail-list">
            {constraints.map((c) => (
              <li key={c.id}>
                <code>{c.id}</code> — {c.description}
              </li>
            ))}
          </ul>
        ) : (
          <p class="hint">No extra constraints.</p>
        )}
      </div>

      <div class="panel">
        <h2>Acceptance & HITL</h2>
        <h3 class="subhead">Done when</h3>
        <ul class="detail-list">
          {bundle.spec.acceptance.map((a) => (
            <li key={a.id}>
              <code>{a.id}</code>
              {a.kind ? ` (${a.kind})` : ""} — {a.description || "—"}
            </li>
          ))}
        </ul>
        <h3 class="subhead">Human gates</h3>
        {hitl.length ? (
          <ul class="detail-list">
            {hitl.map((h) => (
              <li key={h.id}>
                <code>{h.when || h.id}</code> — {h.description || "—"}
              </li>
            ))}
          </ul>
        ) : (
          <p class="hint">No HITL requirements listed.</p>
        )}
      </div>

      <div class="panel">
        <h2>Primitives</h2>
        {primitives.length ? (
          <ul class="prim-chips">
            {primitives.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : (
          <p class="empty">None</p>
        )}
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
