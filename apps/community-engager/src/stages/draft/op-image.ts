import type { CommunityDraft } from "../../types.js";
import {
  DEFAULT_MAX_GALLERY_IMAGES,
  extractImageUrlsFromListingData,
  redditPostIdFromUrl,
} from "../../reddit/listing-image.js";

const IMAGE_HOST_RE =
  /i\.redd\.it|preview\.redd\.it|i\.imgur\.com|imgur\.com\/[A-Za-z0-9]+(\.|$)/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)(\?|$)/i;
const GALLERY_RE = /reddit\.com\/gallery\//i;
const VIDEO_RE = /v\.redd\.it|\.gifv(\?|$)/i;

const MAX_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;

export { DEFAULT_MAX_GALLERY_IMAGES };

export interface FetchedOpImage {
  /** `data:<mime>;base64,…` for multimodal LLM parts. */
  dataUrl: string;
  mimeType: string;
  sourceUrl: string;
  bytes: number;
}

function isDirectImageUrl(url: string): boolean {
  const u = url.trim();
  if (!u || GALLERY_RE.test(u) || VIDEO_RE.test(u)) return false;
  return IMAGE_HOST_RE.test(u) || IMAGE_EXT_RE.test(u);
}

/**
 * Prefer a scout-resolved CDN URL (`imageUrl`), then a direct `postUrl`.
 * Galleries need {@link resolveOpImageUrlsAsync}.
 */
export function resolveOpImageUrl(draft: {
  imageUrl?: string | null;
  postUrl?: string | null;
  threadUrl?: string | null;
}): string | undefined {
  return resolveOpImageUrls(draft)[0];
}

/** Sync direct URLs only (no gallery JSON). At most one without async resolve. */
export function resolveOpImageUrls(draft: {
  imageUrl?: string | null;
  postUrl?: string | null;
  threadUrl?: string | null;
}): string[] {
  const imageUrl = (draft.imageUrl ?? "").trim();
  if (imageUrl && isDirectImageUrl(imageUrl)) return [imageUrl];

  const postUrl = (draft.postUrl ?? "").trim();
  if (!postUrl) return [];
  if (GALLERY_RE.test(postUrl) || VIDEO_RE.test(postUrl)) return [];
  const permalink = (draft.threadUrl ?? "").trim();
  if (
    permalink &&
    postUrl.replace(/\/+$/, "").toLowerCase() ===
      permalink.replace(/\/+$/, "").toLowerCase()
  ) {
    return [];
  }
  if (isDirectImageUrl(postUrl)) return [postUrl];
  return [];
}

/**
 * Fetch Reddit comments JSON and pull gallery / preview image URLs (capped).
 * Fail-open when blocked or malformed.
 */
export async function resolveGalleryImagesViaCommentsJson(
  draft: {
    imageUrl?: string | null;
    postUrl?: string | null;
    threadUrl?: string | null;
  },
  opts?: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    userAgent?: string;
    maxImages?: number;
  }
): Promise<string[]> {
  const postId =
    redditPostIdFromUrl(draft.threadUrl ?? "") ||
    redditPostIdFromUrl(draft.postUrl ?? "");
  if (!postId) return [];

  const maxImages = opts?.maxImages ?? DEFAULT_MAX_GALLERY_IMAGES;
  const timeoutMs = opts?.timeoutMs ?? FETCH_TIMEOUT_MS;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const ua =
    opts?.userAgent ??
    "Mozilla/5.0 (compatible; RelayCommunityEngager/0.1; +https://gostylens.app)";
  const url = `https://www.reddit.com/comments/${encodeURIComponent(postId)}.json?raw_json=1&limit=1`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: "application/json",
        "User-Agent": ua,
      },
    });
  } catch (err) {
    console.warn(
      `[draft:image] gallery json failed: ${err instanceof Error ? err.message : err}`
    );
    return [];
  }
  if (!res.ok) {
    console.warn(`[draft:image] gallery json HTTP ${res.status}`);
    return [];
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    console.warn("[draft:image] gallery json parse failed");
    return [];
  }

  const listing = Array.isArray(raw) ? raw[0] : raw;
  const children =
    listing &&
    typeof listing === "object" &&
    (listing as { data?: { children?: unknown } }).data?.children;
  if (!Array.isArray(children) || children.length === 0) return [];
  const child = children[0];
  const data =
    child && typeof child === "object"
      ? (child as { data?: Record<string, unknown> }).data
      : undefined;
  if (!data || typeof data !== "object") return [];
  return extractImageUrlsFromListingData(data, maxImages);
}

/** @deprecated Prefer {@link resolveGalleryImagesViaCommentsJson}. */
export async function resolveGalleryImageViaCommentsJson(
  draft: Parameters<typeof resolveGalleryImagesViaCommentsJson>[0],
  opts?: Parameters<typeof resolveGalleryImagesViaCommentsJson>[1]
): Promise<string | undefined> {
  const urls = await resolveGalleryImagesViaCommentsJson(draft, opts);
  return urls[0];
}

/** Sync prefer + async gallery fallback (up to maxImages). */
export async function resolveOpImageUrlsAsync(
  draft: {
    imageUrl?: string | null;
    postUrl?: string | null;
    threadUrl?: string | null;
  },
  opts?: Parameters<typeof resolveGalleryImagesViaCommentsJson>[1]
): Promise<string[]> {
  const maxImages = opts?.maxImages ?? DEFAULT_MAX_GALLERY_IMAGES;
  const direct = resolveOpImageUrls(draft);
  if (direct.length > 0) return direct.slice(0, maxImages);

  const postUrl = (draft.postUrl ?? "").trim();
  if (!GALLERY_RE.test(postUrl)) return [];
  return resolveGalleryImagesViaCommentsJson(draft, opts);
}

/** @deprecated Prefer {@link resolveOpImageUrlsAsync}. */
export async function resolveOpImageUrlAsync(
  draft: Parameters<typeof resolveOpImageUrlsAsync>[0],
  opts?: Parameters<typeof resolveOpImageUrlsAsync>[1]
): Promise<string | undefined> {
  const urls = await resolveOpImageUrlsAsync(draft, opts);
  return urls[0];
}

function sniffMime(buf: Uint8Array, fallbackUrl: string): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46
  ) {
    return "image/gif";
  }
  if (/\.png(\?|$)/i.test(fallbackUrl)) return "image/png";
  if (/\.webp(\?|$)/i.test(fallbackUrl)) return "image/webp";
  if (/\.gif(\?|$)/i.test(fallbackUrl)) return "image/gif";
  return "image/jpeg";
}

/**
 * Download OP image bytes and return a data URL for vision drafts.
 * Fail-open: returns null on timeout / non-image / oversized responses.
 */
export async function fetchOpImageAsDataUrl(
  url: string,
  opts?: {
    timeoutMs?: number;
    maxBytes?: number;
    fetchImpl?: typeof fetch;
  }
): Promise<FetchedOpImage | null> {
  const timeoutMs = opts?.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = opts?.maxBytes ?? MAX_BYTES;
  const fetchImpl = opts?.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (compatible; RelayCommunityEngager/0.1; +https://gostylens.app)",
      },
    });
  } catch (err) {
    console.warn(
      `[draft:image] fetch failed: ${err instanceof Error ? err.message : err}`
    );
    return null;
  }

  if (!res.ok) {
    console.warn(`[draft:image] HTTP ${res.status} for ${url.slice(0, 120)}`);
    return null;
  }

  const contentType = (res.headers.get("content-type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  if (contentType && !contentType.startsWith("image/")) {
    console.warn(`[draft:image] non-image content-type=${contentType}`);
    return null;
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > maxBytes) {
    console.warn(
      `[draft:image] skip bytes=${buf.byteLength} (max=${maxBytes})`
    );
    return null;
  }

  const mimeType =
    contentType && contentType.startsWith("image/")
      ? contentType
      : sniffMime(buf, url);
  const dataUrl = `data:${mimeType};base64,${Buffer.from(buf).toString("base64")}`;
  return {
    dataUrl,
    mimeType,
    sourceUrl: url,
    bytes: buf.byteLength,
  };
}

export type LoadDraftOpImagesOptions = Parameters<
  typeof fetchOpImageAsDataUrl
>[1] & {
  userAgent?: string;
  maxImages?: number;
};

/** Resolve + fetch up to {@link DEFAULT_MAX_GALLERY_IMAGES} OP images. */
export async function loadDraftOpImages(
  draft: Pick<CommunityDraft, "postUrl" | "threadUrl" | "imageUrl">,
  opts?: LoadDraftOpImagesOptions
): Promise<FetchedOpImage[]> {
  const maxImages = opts?.maxImages ?? DEFAULT_MAX_GALLERY_IMAGES;
  const urls = await resolveOpImageUrlsAsync(draft, {
    timeoutMs: opts?.timeoutMs,
    fetchImpl: opts?.fetchImpl,
    userAgent: opts?.userAgent,
    maxImages,
  });
  if (urls.length === 0) return [];

  const out: FetchedOpImage[] = [];
  for (const url of urls) {
    if (out.length >= maxImages) break;
    const img = await fetchOpImageAsDataUrl(url, opts);
    if (img) out.push(img);
  }
  return out;
}

/** Resolve + fetch first usable OP image; null when none. */
export async function loadDraftOpImage(
  draft: Pick<CommunityDraft, "postUrl" | "threadUrl" | "imageUrl">,
  opts?: LoadDraftOpImagesOptions
): Promise<FetchedOpImage | null> {
  const imgs = await loadDraftOpImages(draft, {
    ...opts,
    maxImages: 1,
  });
  return imgs[0] ?? null;
}
