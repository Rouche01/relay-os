/**
 * Subset of redditapis.com listing post fields we consume.
 * @see https://docs.redditapis.com/docs/listings/posts
 */
export interface RedditApisPost {
  id?: string;
  name?: string;
  title?: string;
  author?: string;
  permalink?: string;
  url?: string;
  link_url?: string | null;
  text?: string;
  subreddit?: string;
  comments?: number;
  created_utc?: number;
  stickied?: boolean;
  locked?: boolean;
  over_18?: boolean;
  is_self?: boolean;
}

export interface RedditApisPostsResponse {
  posts?: RedditApisPost[];
  after?: string | null;
}
