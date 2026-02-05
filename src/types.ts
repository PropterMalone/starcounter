// AT Protocol and Bluesky API type definitions

/**
 * AT-URI format: at://did:plc:xxxxx/app.bsky.feed.post/xxxxx
 * or at://{handle}/app.bsky.feed.post/{post_id}
 */
export type AtUri = string;

/**
 * Content Identifier - cryptographic hash of content
 */
export type Cid = string;

/**
 * Decentralized Identifier
 */
export type Did = string;

/**
 * ISO 8601 datetime string
 */
export type IsoDateTime = string;

/**
 * Profile view with basic user information
 */
export interface ProfileViewBasic {
  did: Did;
  handle: string;
  displayName?: string;
  avatar?: string;
  associated?: {
    lists?: number;
    feedgens?: number;
    starterPacks?: number;
    labeler?: boolean;
    chat?: {
      allowIncoming: 'all' | 'none' | 'following';
    };
  };
  viewer?: {
    muted?: boolean;
    blockedBy?: boolean;
    blocking?: string;
    blockingByList?: {
      uri: string;
      cid: string;
      name: string;
      purpose: string;
    };
    following?: string;
    followedBy?: string;
  };
  labels?: Label[];
  createdAt?: IsoDateTime;
}

/**
 * Content label for moderation
 */
export interface Label {
  src: Did;
  uri: string;
  cid?: Cid;
  val: string;
  neg?: boolean;
  cts: IsoDateTime;
  exp?: IsoDateTime;
  sig?: Uint8Array;
}

/**
 * Post record content
 */
export interface PostRecord {
  text: string;
  createdAt: IsoDateTime;
  reply?: {
    root: { uri: AtUri; cid: Cid };
    parent: { uri: AtUri; cid: Cid };
  };
  embed?: unknown; // Simplified for now
  entities?: unknown;
  facets?: unknown;
  labels?: unknown;
  langs?: string[];
  tags?: string[];
}

/**
 * Post view with engagement metrics
 */
export interface PostView {
  uri: AtUri;
  cid: Cid;
  author: ProfileViewBasic;
  record: PostRecord;
  embed?: unknown;
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  indexedAt: IsoDateTime;
  viewer?: {
    repost?: string;
    like?: string;
    threadMuted?: boolean;
    replyDisabled?: boolean;
    embeddingDisabled?: boolean;
    pinned?: boolean;
  };
  labels?: Label[];
  threadgate?: unknown;
}

/**
 * Post not found (deleted, taken down, or never existed)
 */
export interface NotFoundPost {
  uri: AtUri;
  notFound: true;
}

/**
 * Post from blocked author
 */
export interface BlockedPost {
  uri: AtUri;
  blocked: true;
  author: {
    did: Did;
    viewer?: {
      blockedBy?: boolean;
      blocking?: string;
    };
  };
}

/**
 * Thread view post with parent and replies
 */
export interface ThreadViewPost {
  post: PostView;
  parent?: ThreadViewPost | NotFoundPost | BlockedPost;
  replies?: Array<ThreadViewPost | NotFoundPost | BlockedPost>;
}

/**
 * Response from getPostThread endpoint
 */
export interface GetPostThreadResponse {
  thread: ThreadViewPost | NotFoundPost | BlockedPost;
  threadgate?: unknown;
}

/**
 * Response from getQuotes endpoint
 */
export interface GetQuotesResponse {
  uri: AtUri;
  cid?: Cid;
  cursor?: string;
  posts: PostView[];
}

/**
 * Rate limit information from response headers
 */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp
  policy: string; // Format: "limit;w=window"
}

/**
 * API error response
 */
export interface ApiError {
  error: string;
  message: string;
}

/**
 * Result type for operations that can fail
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
