import type { RedditListingPost } from "./client.js";

/** Raw shape returned from in-page evaluate (www.reddit shreddit-post attrs). */
export interface ExtractedListingRow {
  id: string;
  name: string;
  subreddit: string;
  title: string;
  selftext: string;
  author: string;
  createdUtc: number;
  permalinkPath: string;
}

/**
 * Structured extract for www.reddit feed pages.
 * Prefers shreddit-post attributes (id, post-title, permalink, …) over class soup.
 * Runs in the browser via page.evaluate — must stay self-contained.
 *
 * Note: old.reddit now forces login for anonymous users; www.reddit is the
 * anonymous listing surface for Phase 1.
 */
export function extractListingRowsFromDocument(): ExtractedListingRow[] {
  const posts = document.querySelectorAll("shreddit-post");
  const rows: ExtractedListingRow[] = [];
  const seen = new Set<string>();

  for (const el of Array.from(posts)) {
    const name = el.getAttribute("id") || "";
    const id = name.replace(/^t3_/, "");
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const title = (el.getAttribute("post-title") || "").trim();
    if (!title) continue;

    const subreddit = (
      el.getAttribute("subreddit-name") ||
      el.getAttribute("subreddit-prefixed-name") ||
      ""
    ).replace(/^r\//i, "");
    const author = el.getAttribute("author") || "";
    const permalinkPath =
      el.getAttribute("permalink") ||
      el.getAttribute("content-href") ||
      `/r/${subreddit}/comments/${id}/`;

    const createdRaw = el.getAttribute("created-timestamp") || "";
    let createdUtc = 0;
    if (createdRaw) {
      const ms = Date.parse(createdRaw);
      if (!Number.isNaN(ms)) createdUtc = Math.floor(ms / 1000);
    }

    // Feed snippets often live in non-title comment links under the post.
    let selftext = "";
    const expando = el.querySelector(
      'a[slot="text-expando"], [data-click-id="text"]'
    );
    if (expando?.textContent) {
      selftext = expando.textContent.trim();
    }
    if (!selftext) {
      const candidates = Array.from(
        el.querySelectorAll('a[href*="/comments/"]')
      )
        .map((a) => (a.textContent || "").trim())
        .filter((t) => t && t !== title && t.length > 40);
      selftext = candidates[0] || "";
    }

    rows.push({
      id,
      name: name.startsWith("t3_") ? name : `t3_${id}`,
      subreddit,
      title,
      selftext,
      author,
      createdUtc,
      permalinkPath,
    });
  }

  return rows;
}

export function rowsToListingPosts(
  rows: ExtractedListingRow[],
  fallbackSubreddit: string
): RedditListingPost[] {
  return rows.map((r) => {
    const sub = r.subreddit || fallbackSubreddit;
    const path = r.permalinkPath.startsWith("http")
      ? r.permalinkPath
      : r.permalinkPath.startsWith("/")
        ? `https://www.reddit.com${r.permalinkPath}`
        : `https://www.reddit.com/${r.permalinkPath}`;
    return {
      id: r.id,
      name: r.name.startsWith("t3_") ? r.name : `t3_${r.id}`,
      subreddit: sub,
      title: r.title,
      selftext: r.selftext,
      url: path,
      permalink: path,
      createdUtc: r.createdUtc || Math.floor(Date.now() / 1000),
      author: r.author,
    };
  });
}

export function listingUrl(subreddit: string, sort: "new" | "hot" = "new"): string {
  const sub = subreddit.replace(/^r\//i, "");
  return `https://www.reddit.com/r/${encodeURIComponent(sub)}/${sort}/`;
}

/** Wait target for feed hydration (custom element, not CSS class soup). */
export const LISTING_READY_SELECTOR = "shreddit-post";
