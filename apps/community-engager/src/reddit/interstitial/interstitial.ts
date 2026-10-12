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
 * - Never treat bare reCAPTCHA/hCaptcha iframes as captcha_widget. Reddit embeds
 *   them in normal chrome (often zero-size / offscreen). That caused scout to
 *   HITL when the headed window showed a normal listing with no CAPTCHA.
 * - Real challenges show humanity / rate-limit copy (or a login username gate).
 * - Guest chrome always has "Log In" / "Sign Up". Counting those as a login
 *   wall false-positives after CAPTCHA clears → auto-detect never fires.
 * - Feed content present ⇒ not an interstitial.
 */
export async function detectInterstitial(
  page: Page
): Promise<InterstitialDetection> {
  try {
    const info = await page.evaluate(() => {
      const title = document.title ?? "";
      const bodyText = (document.body?.innerText ?? "").slice(0, 3500);
      // Auth modal / full-page gate — username field only (not top-nav Log In).
      const hasAuthModal = Boolean(
        document.querySelector('[data-testid="login-username"]') ||
          document.querySelector('input[name="username"]') ||
          document.querySelector('faceplate-text-input[name="username"]') ||
          document.querySelector("#login-username")
      );
      const hasFeedContent = Boolean(
        document.querySelector("shreddit-post") ||
          document.querySelector('[data-testid="post-container"]') ||
          document.querySelector("article[id^='t3_']") ||
          document.querySelector("shreddit-feed")
      );
      const path = (location.pathname || "").toLowerCase();
      const onAuthPath =
        path.includes("/login") ||
        path.includes("/register") ||
        path.includes("/account");
      return {
        title,
        bodyText,
        hasAuthModal,
        hasFeedContent,
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

    // Feed already rendered — not a wall.
    if (info.hasFeedContent) {
      return { challenged: false, title: info.title };
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

    // No copy-based wall and no username gate. Do not escalate on buried
    // captcha iframes — those are invisible chrome, not a visible challenge.
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
