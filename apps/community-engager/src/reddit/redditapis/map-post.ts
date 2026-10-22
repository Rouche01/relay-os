import type { RedditListingPost } from "../client.js";
import type { RedditApisPost } from "./types.js";

/** Normalize permalink to a full reddit.com URL. */
export function normalizeRedditPermalink(
  permalink: string,
  fallbackUrl?: string
): string {
  const raw = (permalink || fallbackUrl || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return `https://www.reddit.com${path}`;
}

/**
 * Prefer the media/external destination Reddit attached to the post.
 * Crossposts often leave `link_url` null on the wrapper — fall back to origin.
 */
export function resolveRedditApisMediaUrl(post: RedditApisPost): string {
  const direct = String(post.link_url ?? "").trim();
  if (direct) return direct;
  const origin = post.crosspost_origin;
  if (origin && typeof origin === "object") {
    const fromOrigin = String(origin.link_url ?? "").trim();
    if (fromOrigin) return fromOrigin;
  }
  return "";
}

/**
 * Map a redditapis listing post → shared {@link RedditListingPost}
 * (`text` → selftext, `comments` → numComments, `link_url` → media `url`).
 */
export function mapRedditApisPost(post: RedditApisPost): RedditListingPost | null {
  const id = String(post.id ?? "").trim();
  if (!id) return null;

  const name = String(post.name ?? "").trim() || `t3_${id}`;
  const subreddit = String(post.subreddit ?? "")
    .replace(/^r\//i, "")
    .trim();
  const permalink = normalizeRedditPermalink(
    String(post.permalink ?? ""),
    String(post.url ?? "")
  );
  const mediaUrl = resolveRedditApisMediaUrl(post);
  const linkOrPermalink = mediaUrl || permalink;
  const numComments = Number(post.comments);
  const createdUtc = Number(post.created_utc);
  const isSelf =
    typeof post.is_self === "boolean"
      ? post.is_self
      : mediaUrl
        ? false
        : undefined;

  return {
    id,
    name,
    subreddit,
    title: String(post.title ?? ""),
    selftext: String(post.text ?? ""),
    url: linkOrPermalink,
    permalink: permalink || linkOrPermalink,
    createdUtc: Number.isFinite(createdUtc) ? createdUtc : 0,
    author: String(post.author ?? ""),
    numComments: Number.isFinite(numComments) ? numComments : undefined,
    ...(isSelf !== undefined ? { isSelf } : {}),
  };
}

export function mapRedditApisPosts(posts: RedditApisPost[]): RedditListingPost[] {
  const out: RedditListingPost[] = [];
  for (const p of posts) {
    const mapped = mapRedditApisPost(p);
    if (mapped) out.push(mapped);
  }
  return out;
}
