import type {
  AgenticAppManifest,
  ServiceDescriptor,
  SpecV2,
  SpecV2Body,
  SpecV2Trigger,
} from "@relay/protocol";
import type { EvalFixturePack } from "@relay/spec-evals";
import type { RelayStepsBlock } from "@relay/spec-lower";

export const RELAY_APP_BUNDLE_KIND = "relay.app.bundle" as const;
export const RELAY_APP_BUNDLE_VERSION = 1 as const;

/** Portable lowered slice — enough to arm schedules without re-lowering. */
export type RelayAppBundleLowered = {
  kind: "relay.spec.v2";
  version: 1;
  specHash: string;
  manifest: AgenticAppManifest;
  relay: RelayStepsBlock;
};

/**
 * Content-addressed Relay App package.
 * `id` is sha256 of the canonical payload (excludes `id` + `exportedAt`).
 */
export type RelayAppBundle = {
  kind: typeof RELAY_APP_BUNDLE_KIND;
  version: typeof RELAY_APP_BUNDLE_VERSION;
  id: string;
  specHash: string;
  exportedAt: string;
  /** Frozen Spec record (lifecycle). */
  frozen: SpecV2;
  /** Authoring body (hash source of truth). */
  body: SpecV2Body;
  lowered: RelayAppBundleLowered;
  /** Service descriptors required by Spec.services (embedded, closed catalog slice). */
  descriptors: ServiceDescriptor[];
  /** Connection refs the operator must supply (no secrets). */
  requiredConnections: string[];
  /** Offline eval fixture pack generated at export (pre-freeze gate snapshot). */
  evals: EvalFixturePack;
  /** Spec v2.1 trigger (also on body / relay). */
  trigger?: SpecV2Trigger;
};

export type BuildRelayAppBundleOptions = {
  /** Prefer frozen Spec; otherwise draft+freeze from body. */
  frozen?: SpecV2;
  body?: SpecV2Body;
  /** Full catalog; only Spec.services ids are embedded. */
  services: readonly ServiceDescriptor[];
  /** Manifest name override. */
  name?: string;
  frozenBy?: string;
  /** Override generated evals. */
  evals?: EvalFixturePack;
  /** Fixed export timestamp (tests). */
  exportedAt?: string;
};

export type RelayAppBundleIssue = {
  code: string;
  message: string;
};

export type VerifyRelayAppBundleResult =
  | { ok: true; bundle: RelayAppBundle }
  | { ok: false; errors: RelayAppBundleIssue[] };
