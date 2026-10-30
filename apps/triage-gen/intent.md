# Intent — GitHub bug triage (forcing function)

Every weekday at 09:00 (host timezone), find open issues labeled `bug` in
repo **acme/widgets**, draft a short triage comment for each new issue, ask me
before posting, and never comment on the same issue twice.

## Goal

Help maintainers respond quickly to new bug reports with a consistent first
triage comment — without posting spam or acting without a human.

## Slots (locked for this fixture)

| Slot | Value | Notes |
|------|-------|-------|
| owner | `acme` | Replace when connecting a real repo |
| repo | `widgets` | Replace when connecting a real repo |
| label | `bug` | Exact label filter |
| schedule | weekdays 09:00 | Cron `0 9 * * 1-5`, host TZ |
| connection | `github:default` | Secrets never in Spec |
| maxJobs | `10` | Cap fan-out per tick |

## Constraints

- Only open issues with label `bug` in `acme/widgets`.
- Drafts must be concrete triage notes (reproduce? severity? next step) — no
  promotional or off-topic filler.
- No URLs / promo links in draft text (hard rule).
- A human must **approve** (or edit/abort) before any comment is posted.
- Never post a second triage comment on an issue already handled (`once` /
  idempotency key = issue number).
- Default path is **shadow** (live reads, simulated writes) until a human
  enables live after an approved shadow evidence pack.
- Live writes only when `budget.dryRun: false` **and** HITL approved.

## Success signal (outcome)

When live is enabled: for each approved triage comment, the issue should show
a maintainer reaction or reply within ~72h (soft outcome metric — measured by
a follow-up entrypoint once outcome scheduling exists). Near-term success bar
is operational (see `SUCCESS.md`), not this metric.
