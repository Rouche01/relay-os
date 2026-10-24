import type {
  ComposeDefaults,
  ComposeExpansion,
  DomainPack,
  Intent,
} from "@relay/protocol";
import type { CommunityEntrypoint } from "../../manifest.js";
import {
  buildAcceptance,
  buildAllowedActions,
  buildConstraints,
  buildHitlRequired,
  goalForEntrypoint,
} from "../engage-spec-fields.js";
import {
  COMMUNITY_ENGAGER_APP_ID,
  resolveEntrypoint,
  resolveFeedbackAdapterSlot,
  slotBool,
  slotNumber,
  type FeedbackAdapterKind,
} from "../engage-slots.js";

export type CommunityComposeDefaults = {
  entrypoint?: CommunityEntrypoint;
  maxJobs?: number;
  dryRun?: boolean;
  forceDiscover?: boolean;
  allowPromo?: boolean;
  adapter?: FeedbackAdapterKind;
};

function asCommunityDefaults(
  defaults?: ComposeDefaults
): CommunityComposeDefaults {
  return (defaults ?? {}) as CommunityComposeDefaults;
}

function resolveRunParams(intent: Intent, defaults?: ComposeDefaults) {
  const d = asCommunityDefaults(defaults);
  const slots = intent.slots;
  const entrypoint = resolveEntrypoint(slots, d.entrypoint ?? "engage");
  const maxJobs = slotNumber(slots, "maxJobs", d.maxJobs ?? 3);
  const dryRun = slotBool(slots, "dryRun", d.dryRun ?? true);
  const forceDiscover = slotBool(
    slots,
    "forceDiscover",
    d.forceDiscover ?? false
  );
  const allowPromo = slotBool(slots, "allowPromo", d.allowPromo ?? true);
  const adapter = resolveFeedbackAdapterSlot(slots, d.adapter);
  return {
    entrypoint,
    maxJobs,
    dryRun,
    forceDiscover,
    allowPromo,
    adapter,
  };
}

function expandForEntrypoint(
  intent: Intent,
  entrypoint: CommunityEntrypoint,
  defaults?: ComposeDefaults
): ComposeExpansion {
  const d = asCommunityDefaults(defaults);
  const slots = intent.slots;
  const maxJobs = slotNumber(slots, "maxJobs", d.maxJobs ?? 3);
  const dryRun = slotBool(slots, "dryRun", d.dryRun ?? true);
  const forceDiscover = slotBool(
    slots,
    "forceDiscover",
    d.forceDiscover ?? false
  );
  const allowPromo = slotBool(slots, "allowPromo", d.allowPromo ?? true);
  const adapter = resolveFeedbackAdapterSlot(slots, d.adapter);

  return {
    goal: goalForEntrypoint(entrypoint, intent.goal),
    procedure: {
      appId: COMMUNITY_ENGAGER_APP_ID,
      entrypoint,
    },
    actionBinding: "browser",
    constraints: buildConstraints({
      entrypoint,
      maxJobs,
      dryRun,
      forceDiscover,
      allowPromo,
      adapter,
    }),
    allowedActions: buildAllowedActions({ entrypoint, allowPromo }),
    acceptance: buildAcceptance({ entrypoint, dryRun, allowPromo }),
    hitlRequired: buildHitlRequired({ allowPromo }),
    budget: { maxJobs, dryRun },
  };
}

/** Pack: community-engager / post_watch */
export const communityPostWatchPack: DomainPack = {
  id: "community-engager/post_watch",
  match: (intent, defaults) =>
    resolveRunParams(intent, defaults).entrypoint === "post_watch",
  expand: (intent, defaults) =>
    expandForEntrypoint(intent, "post_watch", defaults),
};

/** Pack: community-engager / engage (default dogfood) */
export const communityEngagePack: DomainPack = {
  id: "community-engager/engage",
  match: (intent, defaults) =>
    resolveRunParams(intent, defaults).entrypoint === "engage",
  expand: (intent, defaults) =>
    expandForEntrypoint(intent, "engage", defaults),
};

/**
 * CommunityEngager packs for {@link composeIntent}.
 * Order: post_watch first (specific), then engage.
 */
export const communityEngagerPacks: DomainPack[] = [
  communityPostWatchPack,
  communityEngagePack,
];
