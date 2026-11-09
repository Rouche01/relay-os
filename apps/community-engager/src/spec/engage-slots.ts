import type { IntentSlots } from "@relay/protocol";
import {
  normalizeCommunityEntrypoint,
  type CommunityEntrypoint,
} from "../manifest.js";

/** Stable app id for Spec.procedure.appId */
export const COMMUNITY_ENGAGER_APP_ID = "community-engager";

/** HITL surface for Spec / draft negotiation (host concern; recorded on Spec). */
export type FeedbackAdapterKind = "cli" | "telegram" | "desk";

/** Known Intent.slots keys for engage / post_watch template fill. */
export type EngageIntentSlotKey =
  | "entrypoint"
  | "maxJobs"
  | "dryRun"
  | "forceDiscover"
  | "allowPromo"
  | "adapter"
  | "pack";

export type EngageCompileOptions = {
  /** Defaults from env/app when slots omit a value. */
  defaults?: {
    entrypoint?: CommunityEntrypoint;
    maxJobs?: number;
    dryRun?: boolean;
    forceDiscover?: boolean;
    allowPromo?: boolean;
    adapter?: FeedbackAdapterKind;
  };
  /** Spec id override (tests). */
  specId?: string;
  intentId?: string;
};

export function slotString(
  slots: IntentSlots,
  key: string
): string | undefined {
  const v = slots[key];
  if (v === undefined || v === null) return undefined;
  return String(v).trim();
}

export function slotBool(
  slots: IntentSlots,
  key: string,
  fallback: boolean
): boolean {
  const v = slots[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

export function slotNumber(
  slots: IntentSlots,
  key: string,
  fallback: number
): number {
  const v = slots[key];
  if (v === undefined || v === null || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function resolveEntrypoint(
  slots: IntentSlots,
  fallback: CommunityEntrypoint
): CommunityEntrypoint {
  const pack = slotString(slots, "pack")?.toLowerCase().replace(/-/g, "_");
  if (pack === "post_watch" || pack === "community_engager/post_watch") {
    return "post_watch";
  }
  if (pack === "engage_presence" || pack === "community_engager/engage_presence") {
    return "engage_presence";
  }
  if (pack === "engage_help" || pack === "community_engager/engage_help") {
    return "engage_help";
  }
  if (pack === "create" || pack === "community_engager/create") {
    return "create";
  }
  if (pack === "engage" || pack === "community_engager/engage") {
    return "engage";
  }

  const raw = slotString(slots, "entrypoint");
  const normalized = normalizeCommunityEntrypoint(raw);
  if (normalized) return normalized;
  if (raw?.toLowerCase().replace(/-/g, "_") === "scout") return "engage";
  return fallback;
}

/**
 * Read `adapter` / `feedbackAdapter` slot (`cli` | `telegram` | `desk`).
 * Returns undefined when unset / unknown so the host can fall back to env.
 */
export function resolveFeedbackAdapterSlot(
  slots: IntentSlots,
  fallback?: FeedbackAdapterKind
): FeedbackAdapterKind | undefined {
  const raw =
    slotString(slots, "adapter")?.toLowerCase() ??
    slotString(slots, "feedbackAdapter")?.toLowerCase();
  if (raw === "cli" || raw === "terminal" || raw === "stdin") return "cli";
  if (raw === "telegram" || raw === "tg") return "telegram";
  if (raw === "desk" || raw === "desktop" || raw === "relay-desk") return "desk";
  return fallback;
}
