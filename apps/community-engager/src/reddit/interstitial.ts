import type { Page } from "playwright";

export type InterstitialReason =
  | "humanity_wall"
  | "captcha_widget"
  | "login_wall"
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

/** Strong login-gate copy — NOT bare nav "Log In" / "Sign Up" (every guest page). */
const LOGIN_WALL_STRONG = [
  "join the most real place",
  "continue with google",
  "continue with apple",
  "continue with email",
  "continue with phone",
];

/**
 * Classify a Reddit page as an anti-bot interstitial, login wall, or rate limit.
 * Fast (~page.evaluate once) — call right after goto, before waitForSelector.
 * Never attempts to solve challenges.
 *
 * Important:
 * - Bare reCAPTCHA iframes are common on Reddit login/marketing chrome.
 *   Do NOT treat iframe-alone as captcha_widget.
 * - Guest chrome always has "Log In" / "Sign Up". Counting those as a login
 *   wall false-positives after CAPTCHA clears → auto-detect never fires.
 */
export async function detectInterstitial(
  page: Page
): Promise<InterstitialDetection> {
  try {
    const info = await page.evaluate(() => {
      const title = document.title ?? "";
      const bodyText = (document.body?.innerText ?? "").slice(0, 3500);
      const hasRecaptcha = Boolean(
        document.querySelector('iframe[src*="recaptcha"]') ||
          document.querySelector(".g-recaptcha") ||
          document.querySelector("#rc-anchor-container")
      );
      const hasHcaptcha = Boolean(
        document.querySelector('iframe[src*="hcaptcha"]') ||
          document.querySelector(".h-captcha")
      );
      // Auth modal / full-page gate (not top-nav Log In link alone).
      const hasAuthModal = Boolean(
        document.querySelector('[data-testid="login-username"]') ||
          document.querySelector('input[name="username"]') ||
          document.querySelector('faceplate-text-input[name="username"]') ||
          document.querySelector("#login-username") ||
          document.querySelector('a[href*="/login"][role="button"]')
      );
      const path = (location.pathname || "").toLowerCase();
      const onAuthPath =
        path.includes("/login") ||
        path.includes("/register") ||
        path.includes("/account");
      return {
        title,
        bodyText,
        hasRecaptcha,
        hasHcaptcha,
        hasAuthModal,
        onAuthPath,
      };
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

    // Real login/signup gate — strong copy, auth URL, or username field modal.
    // Do not use bare "log in"+"sign up" (always present for guests).
    const strongLogin = LOGIN_WALL_STRONG.some((p) => blob.includes(p));
    if (strongLogin || info.onAuthPath || info.hasAuthModal) {
      return {
        challenged: true,
        reason: "login_wall",
        title: info.title,
      };
    }

    // Captcha widget without humanity copy. Skip when guest nav is present —
    // Reddit often embeds recaptcha next to Log In chrome on normal pages.
    const guestChrome =
      blob.includes("log in") && blob.includes("sign up");
    if (
      (info.hasRecaptcha || info.hasHcaptcha) &&
      !blob.includes("continue with") &&
      !guestChrome
    ) {
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

/** Anonymous / signup overlay — human should log in in the headed window. */
export function isLoginWall(detection: InterstitialDetection): boolean {
  return detection.challenged && detection.reason === "login_wall";
}

/** True when cookie jar looks like a logged-in Reddit session. */
export function storageLooksAuthenticated(cookies: Array<{ name: string }>): boolean {
  // Guest chrome often still has token_v2 / session_tracker / loid.
  // A real login persists reddit_session.
  return cookies.some((c) => c.name === "reddit_session");
}
