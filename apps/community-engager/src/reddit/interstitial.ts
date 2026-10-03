import type { Page } from "playwright";

export type InterstitialReason =
  | "humanity_wall"
  | "captcha_widget"
  | "rate_limit"
  | "unknown";

export interface InterstitialDetection {
  challenged: boolean;
  reason?: InterstitialReason;
  title?: string;
}

const HUMANITY_PHRASES = [
  "prove your humanity",
  "verify you are human",
  "are you a human",
  "blocked by network security",
  "unusual traffic",
  "please complete a security check",
];

const RATE_LIMIT_PHRASES = [
  "whoa there, pardner",
  "too many requests",
  "far too many requests",
  "from your ip address recently",
];

/**
 * Classify a Reddit page as an anti-bot interstitial or IP rate limit.
 * Fast (~page.evaluate once) — call right after goto, before waitForSelector.
 * Never attempts to solve challenges.
 */
export async function detectInterstitial(
  page: Page
): Promise<InterstitialDetection> {
  try {
    const info = await page.evaluate(() => {
      const title = document.title ?? "";
      const bodyText = (document.body?.innerText ?? "").slice(0, 2500);
      const hasRecaptcha = Boolean(
        document.querySelector('iframe[src*="recaptcha"]') ||
          document.querySelector(".g-recaptcha") ||
          document.querySelector("#rc-anchor-container")
      );
      const hasHcaptcha = Boolean(
        document.querySelector('iframe[src*="hcaptcha"]') ||
          document.querySelector(".h-captcha")
      );
      return { title, bodyText, hasRecaptcha, hasHcaptcha };
    });

    const blob = `${info.title}\n${info.bodyText}`.toLowerCase();

    if (RATE_LIMIT_PHRASES.some((p) => blob.includes(p))) {
      return {
        challenged: true,
        reason: "rate_limit",
        title: info.title,
      };
    }
    if (HUMANITY_PHRASES.some((p) => blob.includes(p))) {
      return {
        challenged: true,
        reason: "humanity_wall",
        title: info.title,
      };
    }
    if (info.hasRecaptcha || info.hasHcaptcha) {
      return {
        challenged: true,
        reason: "captcha_widget",
        title: info.title,
      };
    }
    return { challenged: false, title: info.title };
  } catch {
    return { challenged: false };
  }
}

/** Rate-limit walls need cool-down, not a CAPTCHA solve. */
export function isRateLimit(detection: InterstitialDetection): boolean {
  return detection.challenged && detection.reason === "rate_limit";
}
