import { hashSpecV2 } from "@relay/spec-lower";
import { contentAddressId } from "./hash.js";
import {
  RELAY_APP_BUNDLE_KIND,
  RELAY_APP_BUNDLE_VERSION,
  type RelayAppBundle,
  type RelayAppBundleIssue,
  type VerifyRelayAppBundleResult,
} from "./types.js";

function issue(code: string, message: string): RelayAppBundleIssue {
  return { code, message };
}

/**
 * Fail-closed verification of a parsed bundle (hash, freeze, descriptors).
 */
export function verifyRelayAppBundle(
  value: unknown
): VerifyRelayAppBundleResult {
  const errors: RelayAppBundleIssue[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      errors: [issue("not_object", "Bundle must be an object")],
    };
  }
  const b = value as Record<string, unknown>;

  if (b.kind !== RELAY_APP_BUNDLE_KIND) {
    errors.push(
      issue(
        "kind",
        `Expected kind ${RELAY_APP_BUNDLE_KIND} (got ${JSON.stringify(b.kind)})`
      )
    );
  }
  if (b.version !== RELAY_APP_BUNDLE_VERSION) {
    errors.push(
      issue(
        "version",
        `Unsupported bundle version ${JSON.stringify(b.version)}`
      )
    );
  }
  if (typeof b.id !== "string" || !b.id.startsWith("rapp_")) {
    errors.push(issue("id", "Bundle id must be a rapp_<sha256> content address"));
  }
  if (typeof b.specHash !== "string" || b.specHash.length < 16) {
    errors.push(issue("specHash", "Bundle specHash missing"));
  }
  if (!b.frozen || typeof b.frozen !== "object") {
    errors.push(issue("frozen", "Bundle frozen Spec missing"));
  } else {
    const frozen = b.frozen as { status?: string };
    if (frozen.status !== "frozen") {
      errors.push(
        issue(
          "not_frozen",
          `Frozen Spec status must be frozen (got ${JSON.stringify(frozen.status)})`
        )
      );
    }
  }
  if (!b.body || typeof b.body !== "object") {
    errors.push(issue("body", "Bundle body missing"));
  }
  if (!b.lowered || typeof b.lowered !== "object") {
    errors.push(issue("lowered", "Bundle lowered missing"));
  }
  if (!Array.isArray(b.descriptors)) {
    errors.push(issue("descriptors", "Bundle descriptors must be an array"));
  }
  if (!Array.isArray(b.requiredConnections)) {
    errors.push(
      issue(
        "requiredConnections",
        "Bundle requiredConnections must be an array"
      )
    );
  }
  if (!b.evals || typeof b.evals !== "object") {
    errors.push(issue("evals", "Bundle evals missing"));
  }

  if (errors.length) return { ok: false, errors };

  const bundle = value as RelayAppBundle;
  const bodyHash = hashSpecV2(bundle.body);
  if (bodyHash !== bundle.specHash) {
    errors.push(
      issue(
        "spec_hash_mismatch",
        `body hash ${bodyHash.slice(0, 12)}… ≠ bundle.specHash ${bundle.specHash.slice(0, 12)}…`
      )
    );
  }
  if (bundle.lowered.specHash !== bundle.specHash) {
    errors.push(
      issue(
        "lowered_hash_mismatch",
        "lowered.specHash does not match bundle.specHash"
      )
    );
  }

  const serviceIds = new Set(bundle.body.services ?? []);
  const descIds = new Set(bundle.descriptors.map((d) => d.id));
  for (const id of serviceIds) {
    if (!descIds.has(id)) {
      errors.push(
        issue(
          "missing_descriptor",
          `Spec.services lists ${JSON.stringify(id)} but descriptors omit it`
        )
      );
    }
  }

  const req = [...(bundle.body.connections ?? [])].sort().join("\0");
  const got = [...bundle.requiredConnections].sort().join("\0");
  if (req !== got) {
    errors.push(
      issue(
        "connections_mismatch",
        "requiredConnections must equal Spec.connections"
      )
    );
  }

  const { id: _id, exportedAt: _exportedAt, ...payload } = bundle;
  const expectedId = contentAddressId(payload);
  if (bundle.id !== expectedId) {
    errors.push(
      issue(
        "content_address_mismatch",
        `Bundle id does not match content address (got ${bundle.id.slice(0, 20)}… expected ${expectedId.slice(0, 20)}…)`
      )
    );
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, bundle };
}
