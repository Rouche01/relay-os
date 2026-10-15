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
 * @param postUrl - Listing `url` (CDN / gallery), not the comments permalink.
 */
export function inferOpMedia(input: {
  title: string;
  opText?: string;
  postUrl?: string;
}): OpMediaInference {
  const title = input.title ?? "";
  const body = (input.opText ?? "").trim();
  const postUrl = (input.postUrl ?? "").trim();
  const text = `${title}\n${body}`;

  let kind: OpMediaKind = "none";
  if (postUrl && GALLERY_URL_RE.test(postUrl)) kind = "gallery";
  else if (postUrl && VIDEO_URL_RE.test(postUrl)) kind = "video";
  else if (postUrl && IMAGE_URL_RE.test(postUrl)) kind = "image";

  const thinBody = body.length < 80;
  const refersToMedia =
    DEICTIC_RE.test(text) || PHOTO_WORD_RE.test(text);

  if (kind === "none" && thinBody && refersToMedia) {
    // Title-only / “help with these” posts usually have feed images we did not fetch.
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
      `OP included ${what} (or is pointing at garments with words like “these”). ` +
      `You cannot see the media. Do not invent colors, fabrics, cuts, or brands.`,
  };
}
