import type { DomainPack, Intent } from "@relay/protocol";

/**
 * App-agnostic pack for Spec governance UI.
 * Emits primitives only — domain packs (engage, …) live in their apps.
 */
export const relayComposePack: DomainPack = {
  id: "relay/compose",
  match: () => true,
  expand: (intent: Intent) => {
    const slots = intent.slots;
    const maxJobs =
      typeof slots.maxJobs === "number"
        ? slots.maxJobs
        : Number(slots.maxJobs) || 3;
    const dryRun =
      slots.dryRun === undefined || slots.dryRun === null
        ? true
        : Boolean(slots.dryRun === true || slots.dryRun === "true" || slots.dryRun === 1);

    return {
      goal: intent.goal.trim() || "Compose a Spec from Intent",
      procedure: { appId: "relay", entrypoint: "compose" },
      actionBinding: "protocol",
      budget: { maxJobs, dryRun },
      constraints: [
        {
          id: "hitl_before_irreversible",
          description: "Negotiate before irreversible write",
        },
        ...(dryRun
          ? [
              {
                id: "dry_run_default",
                description: "dryRun: simulate irreversible acts",
              },
            ]
          : []),
      ],
      allowedActions: [
        { id: "observe", description: "Observe", sideEffect: "none" as const },
        { id: "read", description: "Read", sideEffect: "none" as const },
        { id: "invoke", description: "Invoke", sideEffect: "reversible" as const },
        { id: "assert", description: "Assert", sideEffect: "none" as const },
        {
          id: "wait_human",
          description: "HITL",
          sideEffect: "none" as const,
        },
        {
          id: "write",
          description: "Write",
          sideEffect: "irreversible" as const,
        },
      ],
      acceptance: [
        {
          id: "intent_captured",
          description: "Intent goal recorded on Spec",
          kind: "gate" as const,
        },
        {
          id: "human_freeze",
          description: "Human Approve / Abort via Spec UI or adapter",
          kind: "human" as const,
        },
      ],
      hitlRequired: [
        {
          id: "before_run",
          description: "Approve Spec before treating it as law",
          when: "before_run",
        },
      ],
    };
  },
};
