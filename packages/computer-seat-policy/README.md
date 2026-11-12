# `@relay/computer-seat-policy`

Shared **computer-seat** loop used by desktop browse and (later) phone policy packs:

- Human-like wait sampling (`SeatTimingConfig`)
- Lease → optional setup → observe → decide → act → park
- Observation hooks (`captureScreenshotObservation` / `captureObserveObservation`)

Policy-specific prompts and goals live in `@relay/browse-policy` / `@relay/phone-policy`, not here.
