/**
 * Subset of redditapis.com listing post fields we consume.
 * @see https://docs.redditapis.com/docs/listings/posts
 */
export interface RedditApisCrosspostOrigin {
  id?: string;
  name?: string;
  title?: string;
  permalink?: string;
  url?: string;
  link_url?: string | null;
  text?: string;
  subreddit?: string;
}

export interface RedditApisPost {
  id?: string;
  name?: string;
  title?: string;
  author?: string;
  permalink?: string;
  url?: string;
  /** External / media destination (i.redd.it, gallery, …). Null for pure self posts. */
  link_url?: string | null;
  text?: string;
  subreddit?: string;
  comments?: number;
  created_utc?: number;
  stickied?: boolean;
  locked?: boolean;
  over_18?: boolean;
  is_self?: boolean;
  is_crosspost?: boolean;
  crosspost_origin?: RedditApisCrosspostOrigin | null;
}

export interface RedditApisPostsResponse {
  posts?: RedditApisPost[];
  after?: string | null;
}
