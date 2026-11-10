import type { CommunityDraft } from "../../types.js";

const IMAGE_HOST_RE =
  /i\.redd\.it|preview\.redd\.it|i\.imgur\.com|imgur\.com\/[A-Za-z0-9]+(\.|$)/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)(\?|$)/i;
const GALLERY_RE = /reddit\.com\/gallery\//i;
const VIDEO_RE = /v\.redd\.it|\.gifv(\?|$)/i;

const MAX_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;

export interface FetchedOpImage {
  /** `data:<mime>;base64,…` for multimodal LLM parts. */
  dataUrl: string;
  mimeType: string;
  sourceUrl: string;
  bytes: number;
}

/**
 * Prefer a direct CDN / image file URL from scout (`postUrl`).
 * Galleries and videos are skipped (no first-frame extract yet).
 */
export function resolveOpImageUrl(draft: {
  postUrl?: string | null;
  threadUrl?: string | null;
}): string | undefined {
  const postUrl = (draft.postUrl ?? "").trim();
  if (!postUrl) return undefined;
  if (GALLERY_RE.test(postUrl) || VIDEO_RE.test(postUrl)) return undefined;
  const permalink = (draft.threadUrl ?? "").trim();
  if (
    permalink &&
    postUrl.replace(/\/+$/, "").toLowerCase() ===
      permalink.replace(/\/+$/, "").toLowerCase()
  ) {
    return undefined;
  }
  if (IMAGE_HOST_RE.test(postUrl) || IMAGE_EXT_RE.test(postUrl)) {
    return postUrl;
  }
  return undefined;
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

/** Resolve + fetch for a draft; null when no usable image. */
export async function loadDraftOpImage(
  draft: Pick<CommunityDraft, "postUrl" | "threadUrl">,
  opts?: Parameters<typeof fetchOpImageAsDataUrl>[1]
): Promise<FetchedOpImage | null> {
  const url = resolveOpImageUrl(draft);
  if (!url) return null;
  return fetchOpImageAsDataUrl(url, opts);
}
