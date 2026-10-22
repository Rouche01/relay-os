/**
 * Infer whether the OP post is photo/gallery-led so the draft model
 * does not invent garment details it cannot see.
 */

export type OpMediaKind = "none" | "image" | "gallery" | "video";

const IMAGE_URL_RE =
  /i\.redd\.it|preview\.redd\.it|i\.imgur\.com|\.(jpe?g|png|webp|gif)(\?|$)/i;
const GALLERY_URL_RE = /reddit\.com\/gallery\//i;
const VIDEO_URL_RE = /v\.redd\.it|\.gifv(\?|$)/i;

/** OP points at visible items ("these") rather than describing them in text. */
const DEICTIC_RE =
  /\b(these|this look|this outfit|styling these|help (with |styling )?these|fit ?check)\b/i;
const PHOTO_WORD_RE =
  /\b(photo|photos|pic|pics|image|images|attached|uploaded|swipe)\b/i;

export interface OpMediaInference {
  kind: OpMediaKind;
  /** Short line for the draft prompt / HITL context. Undefined when none. */
  hint?: string;
}

/**
 * @param postUrl - Listing media destination (`link_url` / CDN / gallery), not
 *   the comments permalink when those differ.
 * @param isSelf - When false, Reddit treated this as a link/image/gallery post
 *   even if we lack a CDN URL (common on thin wrappers / some listings).
 */
export function inferOpMedia(input: {
  title: string;
  opText?: string;
  postUrl?: string;
  /** Thread permalink — used to detect when postUrl is only the comments page. */
  permalink?: string;
  isSelf?: boolean;
}): OpMediaInference {
  const title = input.title ?? "";
  const body = (input.opText ?? "").trim();
  const postUrl = (input.postUrl ?? "").trim();
  const permalink = (input.permalink ?? "").trim();
  const text = `${title}\n${body}`;

  const mediaCandidate =
    postUrl &&
    permalink &&
    normalizeUrlKey(postUrl) !== normalizeUrlKey(permalink)
      ? postUrl
      : postUrl && !isRedditCommentsUrl(postUrl)
        ? postUrl
        : "";

  let kind: OpMediaKind = "none";
  if (mediaCandidate && GALLERY_URL_RE.test(mediaCandidate)) kind = "gallery";
  else if (mediaCandidate && VIDEO_URL_RE.test(mediaCandidate)) kind = "video";
  else if (mediaCandidate && IMAGE_URL_RE.test(mediaCandidate)) kind = "image";
  else if (mediaCandidate && !isRedditCommentsUrl(mediaCandidate)) {
    // Non-thread destination (external link / unknown host) — treat as media-led.
    kind = "image";
  }

  const thinBody = body.length < 120;
  const refersToMedia =
    DEICTIC_RE.test(text) || PHOTO_WORD_RE.test(text);

  if (kind === "none" && thinBody && refersToMedia) {
    // Title-only / “help with these” posts usually have feed images we did not fetch.
    kind = "image";
  }

  // Link/image/gallery posts (`is_self: false`) almost always show media in-feed.
  if (kind === "none" && input.isSelf === false) {
    kind = "image";
  }

  if (kind === "none") return { kind };

  const what =
    kind === "gallery"
      ? "a photo gallery"
      : kind === "video"
        ? "a video"
        : "photo(s)";

  return {
    kind,
    hint:
      `OP included ${what} on the thread (or is pointing at garments with words like “these”). ` +
      `Acknowledge the pic(s) in one short beat so the reply feels grounded, ` +
      `but you cannot see the pixels — do not invent colors, fabrics, cuts, logos, or brands. ` +
      `Ask about / suggest around what the title and body actually say.`,
  };
}

function normalizeUrlKey(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

function isRedditCommentsUrl(url: string): boolean {
  return /reddit\.com\/r\/[^/]+\/comments\//i.test(url);
}
