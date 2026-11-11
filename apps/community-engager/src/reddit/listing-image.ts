/**
 * Extract fetchable OP image URL(s) from Reddit listing / comments JSON.
 * Galleries store pixels under media_metadata; single images under preview or url.
 */

const IMAGE_HOST_RE =
  /i\.redd\.it|preview\.redd\.it|i\.imgur\.com|imgur\.com\/[A-Za-z0-9]+(\.|$)/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)(\?|$)/i;
const GALLERY_RE = /reddit\.com\/gallery\//i;

/** Default max gallery slides for multimodal draft. */
export const DEFAULT_MAX_GALLERY_IMAGES = 5;

/** Decode Reddit's HTML-escaped preview URLs (`&amp;` → `&`). */
export function decodeRedditMediaUrl(raw: string): string {
  return raw
    .trim()
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function isDirectImageUrl(url: string): boolean {
  const u = url.trim();
  if (!u || GALLERY_RE.test(u)) return false;
  return IMAGE_HOST_RE.test(u) || IMAGE_EXT_RE.test(u);
}

function urlFromMetaEntry(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const e = entry as {
    status?: string;
    e?: string;
    s?: { u?: string; gif?: string; mp4?: string };
    p?: Array<{ u?: string }>;
  };
  if (e.status && e.status !== "valid") return undefined;
  if (e.e && e.e !== "Image" && e.e !== "AnimatedImage") return undefined;
  const candidates = [
    e.s?.u,
    e.s?.gif,
    ...(Array.isArray(e.p) ? e.p.map((x) => x?.u).reverse() : []),
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) {
      const url = decodeRedditMediaUrl(c);
      if (isDirectImageUrl(url) || /preview\.redd\.it|i\.redd\.it/i.test(url)) {
        return url;
      }
    }
  }
  return undefined;
}

function urlsFromMediaMetadata(
  meta: unknown,
  galleryData: unknown,
  max: number
): string[] {
  if (!meta || typeof meta !== "object" || max <= 0) return [];
  const map = meta as Record<string, unknown>;

  const orderedIds: string[] = [];
  if (galleryData && typeof galleryData === "object") {
    const items = (galleryData as { items?: unknown }).items;
    if (Array.isArray(items)) {
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const id = String((item as { media_id?: unknown }).media_id ?? "").trim();
        if (id) orderedIds.push(id);
      }
    }
  }
  if (orderedIds.length === 0) orderedIds.push(...Object.keys(map));

  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (out.length >= max) break;
    const url = urlFromMetaEntry(map[id]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function urlsFromPreview(preview: unknown, max: number): string[] {
  if (!preview || typeof preview !== "object" || max <= 0) return [];
  const images = (preview as { images?: unknown }).images;
  if (!Array.isArray(images) || images.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const img of images) {
    if (out.length >= max) break;
    if (!img || typeof img !== "object") continue;
    const source = (img as { source?: { url?: string } }).source;
    const url =
      typeof source?.url === "string" ? decodeRedditMediaUrl(source.url) : "";
    if (
      url &&
      (isDirectImageUrl(url) || /preview\.redd\.it/i.test(url)) &&
      !seen.has(url)
    ) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/**
 * Pull up to {@link max} image URLs from a Reddit post `data` object
 * (listing child or comments[0].data.children[0].data), gallery order first.
 */
export function extractImageUrlsFromListingData(
  data: Record<string, unknown>,
  max: number = DEFAULT_MAX_GALLERY_IMAGES
): string[] {
  const limit = Math.max(0, Math.floor(max));
  if (limit === 0) return [];

  const fromMeta = urlsFromMediaMetadata(
    data.media_metadata,
    data.gallery_data,
    limit
  );
  if (fromMeta.length > 0) return fromMeta;

  const fromPreview = urlsFromPreview(data.preview, limit);
  if (fromPreview.length > 0) return fromPreview;

  const url = String(data.url ?? data.url_overridden_by_dest ?? "").trim();
  if (url && isDirectImageUrl(url)) return [decodeRedditMediaUrl(url)];

  const thumb = String(data.thumbnail ?? "").trim();
  if (
    thumb.startsWith("http") &&
    thumb !== "self" &&
    thumb !== "default" &&
    thumb !== "nsfw" &&
    thumb !== "spoiler"
  ) {
    return [decodeRedditMediaUrl(thumb)];
  }

  return [];
}

/**
 * Pull the best single image URL from a Reddit post `data` object.
 */
export function extractImageUrlFromListingData(
  data: Record<string, unknown>
): string | undefined {
  return extractImageUrlsFromListingData(data, 1)[0];
}

/** Post id from `/comments/{id}/` or `/gallery/{id}`. */
export function redditPostIdFromUrl(url: string): string | undefined {
  const u = url.trim();
  const comments = u.match(/\/comments\/([a-z0-9]+)\b/i);
  if (comments?.[1]) return comments[1];
  const gallery = u.match(/\/gallery\/([a-z0-9]+)\b/i);
  if (gallery?.[1]) return gallery[1];
  return undefined;
}
