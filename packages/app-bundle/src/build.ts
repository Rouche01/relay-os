import {
  createDraftSpecV2,
  freezeSpecV2,
  toSpecV2Body,
  type ServiceDescriptor,
  type SpecV2,
  type SpecV2Body,
} from "@relay/protocol";
import { generateEvalFixtures } from "@relay/spec-evals";
import {
  hashSpecV2,
  LOWERED_WORKFLOW_KIND,
  lowerSpecV2,
} from "@relay/spec-lower";
import { RelayAppBundleError } from "./errors.js";
import { contentAddressId } from "./hash.js";
import {
  RELAY_APP_BUNDLE_KIND,
  RELAY_APP_BUNDLE_VERSION,
  type BuildRelayAppBundleOptions,
  type RelayAppBundle,
} from "./types.js";

function resolveFrozenAndBody(options: BuildRelayAppBundleOptions): {
  frozen: SpecV2;
  body: SpecV2Body;
} {
  if (options.frozen) {
    const frozen = options.frozen;
    if (frozen.status !== "frozen") {
      throw new RelayAppBundleError(
        "not_frozen",
        `Relay App bundle requires a frozen Spec (status=${frozen.status})`
      );
    }
    return { frozen, body: toSpecV2Body(frozen) };
  }
  if (!options.body) {
    throw new RelayAppBundleError(
      "missing_spec",
      "buildRelayAppBundle requires frozen or body"
    );
  }
  const draft = createDraftSpecV2({
    ...options.body,
  });
  const frozen = freezeSpecV2(draft, {
    frozenBy: options.frozenBy ?? "relay-app-bundle",
  });
  return { frozen, body: toSpecV2Body(frozen) };
}

function selectDescriptors(
  body: SpecV2Body,
  catalog: readonly ServiceDescriptor[]
): ServiceDescriptor[] {
  const want = body.services ?? [];
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const missing: string[] = [];
  const out: ServiceDescriptor[] = [];
  for (const id of want) {
    const d = byId.get(id);
    if (!d) missing.push(id);
    else out.push(structuredClone(d));
  }
  if (missing.length) {
    throw new RelayAppBundleError(
      "missing_descriptors",
      `Bundle missing service descriptors: ${missing.join(", ")}`,
      { missing }
    );
  }
  return out;
}

/**
 * Build a content-addressed Relay App bundle from a frozen Spec (or body).
 * Embeds only the descriptors listed on Spec.services.
 */
export function buildRelayAppBundle(
  options: BuildRelayAppBundleOptions
): RelayAppBundle {
  const { frozen, body } = resolveFrozenAndBody(options);
  const specHash = hashSpecV2(body);
  const loweredFull = lowerSpecV2(body, {
    name: options.name,
    specId: frozen.id,
    specRecord: {
      id: frozen.id,
      version: frozen.version,
      status: frozen.status,
      intentId: frozen.intentId,
    },
  });
  if (loweredFull.specHash !== specHash) {
    throw new RelayAppBundleError(
      "spec_hash_mismatch",
      "lowered.specHash does not match hash(body)"
    );
  }

  const descriptors = selectDescriptors(body, options.services);
  const requiredConnections = [...(body.connections ?? [])];
  const evals = options.evals ?? generateEvalFixtures(body);

  const payload = {
    kind: RELAY_APP_BUNDLE_KIND,
    version: RELAY_APP_BUNDLE_VERSION,
    specHash,
    frozen,
    body,
    lowered: {
      kind: LOWERED_WORKFLOW_KIND,
      version: 1 as const,
      specHash,
      manifest: loweredFull.manifest,
      relay: loweredFull.relay,
    },
    descriptors,
    requiredConnections,
    evals,
    trigger: body.trigger,
  };

  const id = contentAddressId(payload);
  return {
    ...payload,
    id,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
  };
}
