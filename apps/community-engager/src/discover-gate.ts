import type { DiscoverMode } from "./reddit/config.js";

export interface DiscoverGateInput {
  mode: DiscoverMode;
  /** Count of postable allowlist entries (seed + promoted), not proposed. */
  postableCount: number;
  minPostable: number;
  /**
   * Intent / CLI / post-CAPTCHA continue — any one forces a research pass
   * unless mode is off.
   */
  forceDiscover?: boolean;
}

export interface DiscoverGateResult {
  run: boolean;
  /** Stable skip / run reason for logs and evidence. */
  reason: string;
}

/**
 * Smart discover skip: auto runs only when the postable allowlist is thin.
 * Force overrides (env force, context.forceDiscover) always research unless off.
 */
export function resolveDiscoverGate(input: DiscoverGateInput): DiscoverGateResult {
  if (input.mode === "off") {
    return { run: false, reason: "mode=off" };
  }

  if (input.mode === "force" || input.forceDiscover) {
    return {
      run: true,
      reason: input.forceDiscover && input.mode !== "force" ? "forceDiscover" : "mode=force",
    };
  }

  // auto
  if (input.postableCount < input.minPostable) {
    return {
      run: true,
      reason: `auto:thin postable=${input.postableCount}<${input.minPostable}`,
    };
  }

  return {
    run: false,
    reason: `auto:healthy postable=${input.postableCount}≥${input.minPostable}`,
  };
}
