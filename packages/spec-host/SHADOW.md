# Shadow gate

Enabling a **scheduled** Spec fails closed until a human has approved at least one
complete **shadow** run's evidence pack for that Spec content hash.

## Flow

1. Run the Spec in `mode: "shadow"` (live reads, irreversible writes simulated).
2. Review evidence + simulated writes (Desk shows them side by side).
3. Call `approveShadowEvidence(store, runId)` (or Desk `POST …/approve-evidence`).
4. Call `enableSpecScheduler({ …, runStateStore })` — asserts the gate, then arms
   `SchedulerHost`.

## API

| Helper | Role |
|--------|------|
| `approveShadowEvidence` | Persist `evidenceApproval` on a complete shadow checkpoint |
| `assertShadowGate` | Require ≥1 approved shadow run for `specHash` |
| `enableSpecScheduler` | Gate + `schedulerHostFromSpec` |
| `collectSimulatedWrites` | Step outputs + evidence tagged `shadowWrite` / `dryRunSimulated` |

`schedulerHostFromSpec` alone does **not** enforce the gate (low-level arming /
tests). Production enable paths use `enableSpecScheduler` (default
`requireShadowApproval: true`).

## Checkpoint field

```ts
evidenceApproval?: {
  approvedAt: string;
  approvedBy?: string;
  note?: string;
};
```

Approval is only valid when `mode === "shadow"` and `status === "complete"`.
Fixture / live runs cannot satisfy the gate.
