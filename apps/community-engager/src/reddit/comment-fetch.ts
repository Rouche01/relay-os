/**
 * Public Reddit comment/thread JSON fetch (no OAuth required).
 * Used by post-watch to check visibility and replies.
 */

export interface FetchedComment {
  id: string;
  name: string;
  author: string;
  body: string;
  permalink: string;
  removed: boolean;
  deleted: boolean;
  /** Direct reply bodies (author + text), newest-first capped. */
  replies: Array<{ author: string; body: string; id: string }>;
}

export interface FetchCommentResult {
  ok: boolean;
  comment?: FetchedComment;
  error?: string;
  /** HTTP status when the request completed. */
  status?: number;
}

/**
 * Turn a comment or thread permalink into a .json listing URL.
 */
export function permalinkToJsonUrl(permalink: string): string {
  let url = permalink.trim();
  if (!url.startsWith("http")) {
    url = `https://www.reddit.com${url.startsWith("/") ? "" : "/"}${url}`;
  }
  url = url.split("?")[0]!.replace(/\/$/, "");
  if (!url.endsWith(".json")) url = `${url}.json`;
  return `${url}?raw_json=1`;
}

/** Extract t1_… comment id from a permalink path when present. */
export function commentIdFromPermalink(permalink: string): string | undefined {
  const m = permalink.match(/\/comments\/[^/]+\/[^/]+\/([a-z0-9]+)\/?/i);
  if (m?.[1]) return `t1_${m[1]}`;
  const m2 = permalink.match(/\/comment\/([a-z0-9]+)/i);
  if (m2?.[1]) return `t1_${m2[1]}`;
  return undefined;
}

/**
 * Fetch a comment (or the first comment in a thread listing) via public JSON.
 */
export async function fetchRedditComment(
  permalink: string,
  opts?: { userAgent?: string; timeoutMs?: number }
): Promise<FetchCommentResult> {
  const jsonUrl = permalinkToJsonUrl(permalink);
  const ua =
    opts?.userAgent ??
    "Mozilla/5.0 (compatible; relay-community-engager/0.1; +https://gostylens.app)";
  const timeoutMs = opts?.timeoutMs ?? 15_000;

  let res: Response;
  try {
    res = await fetch(jsonUrl, {
      headers: { "User-Agent": ua, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (res.status === 404) {
    return { ok: false, status: 404, error: "not found (404)" };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: `HTTP ${res.status}`,
    };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    return {
      ok: false,
      status: res.status,
      error: err instanceof Error ? err.message : "invalid JSON",
    };
  }

  const comment = extractCommentFromListing(data, permalink);
  if (!comment) {
    return {
      ok: false,
      status: res.status,
      error: "comment not found in listing",
    };
  }
  return { ok: true, status: res.status, comment };
}

function extractCommentFromListing(
  data: unknown,
  permalink: string
): FetchedComment | undefined {
  const wantId = commentIdFromPermalink(permalink)?.replace(/^t1_/, "");
  const listings = Array.isArray(data) ? data : [data];

  // Prefer matching our comment id in any listing children.
  for (const listing of listings) {
    const children = (listing as { data?: { children?: unknown[] } })?.data
      ?.children;
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      const d = (child as { kind?: string; data?: Record<string, unknown> })
        ?.data;
      const kind = (child as { kind?: string })?.kind;
      if (!d) continue;
      if (kind === "t1" || typeof d.body === "string") {
        const id = String(d.id ?? "");
        if (wantId && id && id !== wantId) continue;
        if (wantId && id === wantId) {
          return mapCommentData(d);
        }
        // No wantId — take first comment-shaped node in a comment listing.
        if (!wantId && typeof d.body === "string") {
          return mapCommentData(d);
        }
      }
    }
  }

  // Thread permalink without comment id: look under post listing's reply tree
  // is unusual for our watches (we store comment permalinks). Fall through.
  for (const listing of listings) {
    const children = (listing as { data?: { children?: unknown[] } })?.data
      ?.children;
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      const d = (child as { data?: Record<string, unknown> })?.data;
      if (d && typeof d.body === "string") return mapCommentData(d);
    }
  }
  return undefined;
}

function mapCommentData(d: Record<string, unknown>): FetchedComment {
  const body = String(d.body ?? "");
  const author = String(d.author ?? "");
  const removedByCategory = d.removed_by_category != null;
  const removed =
    removedByCategory ||
    body === "[removed]" ||
    author === "[deleted]";
  const deleted = body === "[deleted]" || author === "[deleted]";
  const permalink = String(d.permalink ?? "");
  const href = permalink.startsWith("http")
    ? permalink
    : `https://www.reddit.com${permalink}`;

  const replies = collectReplies(d.replies, 8);

  return {
    id: String(d.id ?? ""),
    name: String(d.name ?? (d.id ? `t1_${d.id}` : "")),
    author,
    body,
    permalink: href,
    removed,
    deleted,
    replies,
  };
}

function collectReplies(
  replies: unknown,
  max: number
): Array<{ author: string; body: string; id: string }> {
  if (!replies || typeof replies !== "object") return [];
  const children = (replies as { data?: { children?: unknown[] } }).data
    ?.children;
  if (!Array.isArray(children)) return [];
  const out: Array<{ author: string; body: string; id: string }> = [];
  for (const child of children) {
    if (out.length >= max) break;
    const kind = (child as { kind?: string }).kind;
    const d = (child as { data?: Record<string, unknown> }).data;
    if (kind === "more" || !d || typeof d.body !== "string") continue;
    const body = String(d.body);
    if (body === "[removed]" || body === "[deleted]") continue;
    out.push({
      author: String(d.author ?? ""),
      body: body.slice(0, 2000),
      id: String(d.id ?? ""),
    });
  }
  return out;
}
