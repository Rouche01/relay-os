import type { RedditListingPost } from "../client.js";
import type { RedditApisConfig } from "../config.js";
import { mapRedditApisPosts } from "./map-post.js";
import type { RedditApisPostsResponse } from "./types.js";

export type RedditApisSort =
  | "new"
  | "hot"
  | "top"
  | "rising"
  | "controversial"
  | "best";

export interface RedditApisListOptions {
  /** Listing sort (default new). */
  sort?: RedditApisSort;
  /** 1–100 (API default 25). */
  limit?: number;
  /** Pagination cursor from a previous response. */
  after?: string;
}

/**
 * Read-only redditapis.com client (Bearer API key only).
 * No login, cookies, proxy, comment, vote, or DM — scout/list only.
 */
export class RedditApisClient {
  constructor(private readonly cfg: RedditApisConfig) {
    if (!cfg.configured || !cfg.apiKey?.trim()) {
      throw new Error(
        "RedditApisClient requires REDDITAPIS_API_KEY (read-only scout key)"
      );
    }
  }

  /** Fetch a subreddit listing and map to {@link RedditListingPost}. */
  async listNew(
    subreddit: string,
    limit = 25,
    opts: Omit<RedditApisListOptions, "limit"> = {}
  ): Promise<RedditListingPost[]> {
    const name = subreddit.replace(/^r\//i, "").trim();
    if (!name) {
      throw new Error("RedditApisClient.listNew: subreddit is required");
    }

    const sort = opts.sort ?? "new";
    const capped = Math.min(100, Math.max(1, Math.floor(limit) || 25));
    const params = new URLSearchParams({
      subreddit: name,
      sort,
      limit: String(capped),
    });
    if (opts.after?.trim()) params.set("after", opts.after.trim());

    const base = this.cfg.baseUrl.replace(/\/+$/, "");
    const url = `${base}/api/reddit/posts?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `redditapis listNew r/${name} failed: ${res.status} ${body.slice(0, 400)}`
      );
    }

    const data = (await res.json()) as RedditApisPostsResponse;
    return mapRedditApisPosts(data.posts ?? []);
  }
}
