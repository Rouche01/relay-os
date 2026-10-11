import type { CommunityDraft, PromoIntensity } from "./types.js";

export const PRODUCT_RE = /\bgostylens\b/i;
export const DISCLOSURE_RE =
  /\b(disclosure|disclos(?:e|ing)|i(?:'m| am) the (?:founder|maker|builder)|i built|full disclosure)\b/i;

/**
 * Soft-CTA shaping after draft generation:
 * - 0: help only (no product, no LP link)
 * - 1: help first, soft product mention, no URL
 * - 2: help first, founder disclosure, one LP link (from config + UTM)
 */
export function applySoftCta(
  draft: CommunityDraft,
  opts: {
    lpBaseUrl: string;
    campaign?: string;
    /** Warmup / promo block — force help-only. */
    forceIntensity0?: boolean;
  }
): CommunityDraft {
  const intensity: PromoIntensity = opts.forceIntensity0
    ? 0
    : draft.intensity === 2
      ? 2
      : draft.intensity === 1
        ? 1
        : 0;

  let text = draft.draftText.trim();
  const campaign = opts.campaign ?? draft.utmCampaign ?? "community";
  const lp = normalizeLpBase(opts.lpBaseUrl);

  if (intensity === 0) {
    text = stripProductAndLpLinks(text, lp);
    return { ...draft, intensity: 0, draftText: text };
  }

  // Always strip bare LP URLs before re-applying per intensity rules.
  text = stripLpUrls(text, lp);

  if (intensity === 1) {
    if (!PRODUCT_RE.test(text)) {
      text = appendSoftMention(text);
    }
    // Intensity 1 must not carry a product URL.
    text = stripLpUrls(text, lp);
    return { ...draft, intensity: 1, draftText: text };
  }

  // Intensity 2: disclosure + one tracked LP link.
  if (!DISCLOSURE_RE.test(text)) {
    text = appendDisclosure(text);
  }
  if (!PRODUCT_RE.test(text)) {
    text = `${text} GoStylens is the small helper I built for this.`.trim();
  }
  const tracked = withUtm(lp, campaign);
  if (!containsLpUrl(text, lp)) {
    text = `${text}\n\n${tracked}`.trim();
  } else {
    text = applyUtmToLpUrls(text, lp, campaign);
  }
  return { ...draft, intensity: 2, draftText: text };
}

/** Append UTM params to LP / gostylens links (execute path). */
export function applyUtmLinks(
  text: string,
  lpBaseUrl: string,
  campaign: string
): string {
  const lp = normalizeLpBase(lpBaseUrl);
  return applyUtmToLpUrls(text, lp, campaign);
}

export function normalizeLpBase(raw: string): string {
  const trimmed = (raw || "https://gostylens.app").trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function withUtm(lpBaseUrl: string, campaign: string): string {
  const base = normalizeLpBase(lpBaseUrl);
  const utm = utmQuery(campaign);
  const join = base.includes("?") ? "&" : "?";
  if (/[?&]utm_/i.test(base)) return base;
  return `${base}${join}${utm}`;
}

function utmQuery(campaign: string): string {
  return `utm_source=reddit&utm_medium=community&utm_campaign=${encodeURIComponent(campaign)}`;
}

function lpHostPattern(lpBaseUrl: string): RegExp {
  try {
    const host = new URL(normalizeLpBase(lpBaseUrl)).hostname.replace(
      /\./g,
      "\\."
    );
    return new RegExp(`https?:\\/\\/(?:www\\.)?${host}[^\\s)]*`, "gi");
  } catch {
    return /https?:\/\/(?:www\.)?gostylens\.app[^\s)]*/gi;
  }
}

function stripLpUrls(text: string, lpBaseUrl: string): string {
  return text
    .replace(lpHostPattern(lpBaseUrl), "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function stripProductAndLpLinks(text: string, lpBaseUrl: string): string {
  let out = stripLpUrls(text, lpBaseUrl);
  // Drop sentences that are primarily product plugs.
  out = out
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !PRODUCT_RE.test(s))
    .join(" ")
    .trim();
  return out;
}

function containsLpUrl(text: string, lpBaseUrl: string): boolean {
  lpHostPattern(lpBaseUrl).lastIndex = 0;
  return lpHostPattern(lpBaseUrl).test(text);
}

function applyUtmToLpUrls(
  text: string,
  lpBaseUrl: string,
  campaign: string
): string {
  const utm = utmQuery(campaign);
  return text.replace(lpHostPattern(lpBaseUrl), (url) => {
    if (/[?&]utm_/i.test(url)) return url;
    const join = url.includes("?") ? "&" : "?";
    return `${url}${join}${utm}`;
  });
}

function appendSoftMention(text: string): string {
  const mention =
    "I've been dogfooding a small styling helper (GoStylens) for the system side — no link, just mentioning in case that framing helps.";
  return `${text.trim()}\n\n${mention}`.trim();
}

function appendDisclosure(text: string): string {
  const disclosure =
    "Full disclosure: I'm the founder of GoStylens (a small styling helper).";
  return `${text.trim()}\n\n${disclosure}`.trim();
}

/** True when intensity 1 text incorrectly includes the product LP URL. */
export function hasDisallowedIntensity1Link(
  text: string,
  lpBaseUrl: string
): boolean {
  return containsLpUrl(text, lpBaseUrl);
}
