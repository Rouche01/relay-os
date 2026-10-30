# Spec v2.1 `retry` / `onError`

```yaml
steps:
  - id: post
    use: api.request
    forEach: "${steps.draft.output}"
    once: "${item.issue_number}"
    retry:
      max: 2          # total attempts (including first)
      backoffMs: 500  # optional delay between attempts
    onError: fail     # fail | skip_item | escalate_human
```

## Semantics

| Field | Meaning |
|-------|---------|
| `retry.max` | Total attempts (≥ 1). Default when omitted: 1 (no retry). |
| `retry.backoffMs` | Fixed wait between attempts (default 0). |
| `onError: fail` | After exhaustion, throw (default). Fanout child → failed. |
| `onError: skip_item` | Record skip evidence and continue. |
| `onError: escalate_human` | Pause for HITL; Approve → skip, Abort → fail. |

**Safety:** irreversible steps with `retry.max > 1` **require** `once`
(`retry_without_once`). Shadow/`dryRunSimulated` writes still do not commit
`once` keys (see `ONCE.md`).
