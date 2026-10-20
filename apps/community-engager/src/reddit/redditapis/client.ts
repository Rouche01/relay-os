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

/** Reddit native comment node as returned by GET /api/reddit/comment/{id}. */
export interface RedditApisCommentNode {
  kind?: string;
  data?: Record<string, unknown>;
}

export interface RedditApisGetCommentResult {
  status: number;
  /** Present when HTTP 200 and body includes a comment node. */
  comment?: RedditApisCommentNode;
  /** Truncated error / body text when not ok. */
  error?: string;
}

/**
 * Read-only redditapis.com client (Bearer API key only).
 * No Reddit login/cookies — listings + comment reads (no vote/DM/write).
 */
export class RedditApisClient {
  constructor(private readonly cfg: RedditApisConfig) {
    if (!cfg.configured || !cfg.apiKey?.trim()) {
      throw new Error(
        "RedditApisClient requires REDDITAPIS_API_KEY (read-only scout key)"
      );
    }
  }

  private authHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      Accept: "application/json",
    };
  }

  private base(): string {
    return this.cfg.baseUrl.replace(/\/+$/, "");
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

    const url = `${this.base()}/api/reddit/posts?${params.toString()}`;
    const res = await fetch(url, { headers: this.authHeaders() });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `redditapis listNew r/${name} failed: ${res.status} ${body.slice(0, 400)}`
      );
    }

    const data = (await res.json()) as RedditApisPostsResponse;
    return mapRedditApisPosts(data.posts ?? []);
  }

  /**
   * Fetch one comment by bare id (e.g. `phxxrt8`). Strips a `t1_` prefix if present.
   * @see https://docs.redditapis.com/docs/posts/comment-by-id
   */
  async getComment(
    idOrFullname: string,
    opts?: { timeoutMs?: number }
  ): Promise<RedditApisGetCommentResult> {
    const id = idOrFullname.replace(/^t1_/i, "").trim();
    if (!id || !/^[a-z0-9]{1,16}$/i.test(id)) {
      return {
        status: 400,
        error: `invalid comment id: ${idOrFullname}`,
      };
    }

    const url = `${this.base()}/api/reddit/comment/${id}`;
    const timeoutMs = opts?.timeoutMs ?? 15_000;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      return {
        status: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (res.status === 404) {
      return { status: 404, error: "not found (404)" };
    }
    if (!res.ok) {
      const body = await res.text();
      return {
        status: res.status,
        error: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      };
    }

    let data: { comment?: RedditApisCommentNode | Record<string, unknown> };
    try {
      data = (await res.json()) as {
        comment?: RedditApisCommentNode | Record<string, unknown>;
      };
    } catch (err) {
      return {
        status: res.status,
        error: err instanceof Error ? err.message : "invalid JSON",
      };
    }

    const node = data.comment;
    if (!node) {
      return { status: res.status, error: "comment missing in response" };
    }
    if (
      "data" in node &&
      node.data &&
      typeof node.data === "object"
    ) {
      return { status: res.status, comment: node as RedditApisCommentNode };
    }
    if (typeof (node as { body?: unknown }).body === "string") {
      return {
        status: res.status,
        comment: { kind: "t1", data: node as Record<string, unknown> },
      };
    }
    return { status: res.status, error: "comment missing in response" };
  }
}
