// pattern: Functional Core
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
export type ProfileViewBasic = {
  readonly did: Did;
  readonly handle: string;
  readonly displayName?: string;
  readonly avatar?: string;
  readonly associated?: {
    readonly lists?: number;
    readonly feedgens?: number;
    readonly starterPacks?: number;
    readonly labeler?: boolean;
    readonly chat?: {
      readonly allowIncoming: 'all' | 'none' | 'following';
    };
  };
  readonly viewer?: {
    readonly muted?: boolean;
    readonly blockedBy?: boolean;
    readonly blocking?: string;
    readonly blockingByList?: {
      readonly uri: string;
      readonly cid: string;
      readonly name: string;
      readonly purpose: string;
    };
    readonly following?: string;
    readonly followedBy?: string;
  };
  readonly labels?: Array<Label>;
  readonly createdAt?: IsoDateTime;
};

/**
 * Content label for moderation
 */
export type Label = {
  readonly src: Did;
  readonly uri: string;
  readonly cid?: Cid;
  readonly val: string;
  readonly neg?: boolean;
  readonly cts: IsoDateTime;
  readonly exp?: IsoDateTime;
  readonly sig?: Uint8Array;
};

/**
 * Post record content
 */
export type PostRecord = {
  readonly text: string;
  readonly createdAt: IsoDateTime;
  readonly reply?: {
    readonly root: { readonly uri: AtUri; readonly cid: Cid };
    readonly parent: { readonly uri: AtUri; readonly cid: Cid };
  };
  readonly embed?: unknown; // Simplified for now
  readonly entities?: unknown;
  readonly facets?: unknown;
  readonly labels?: unknown;
  readonly langs?: Array<string>;
  readonly tags?: Array<string>;
};

/**
 * Post view with engagement metrics
 */
export type PostView = {
  readonly uri: AtUri;
  readonly cid: Cid;
  readonly author: ProfileViewBasic;
  readonly record: PostRecord;
  readonly embed?: unknown;
  readonly replyCount?: number;
  readonly repostCount?: number;
  readonly likeCount?: number;
  readonly quoteCount?: number;
  readonly indexedAt: IsoDateTime;
  readonly viewer?: {
    readonly repost?: string;
    readonly like?: string;
    readonly threadMuted?: boolean;
    readonly replyDisabled?: boolean;
    readonly embeddingDisabled?: boolean;
    readonly pinned?: boolean;
  };
  readonly labels?: Array<Label>;
  readonly threadgate?: unknown;
};

/**
 * Post not found (deleted, taken down, or never existed)
 */
export type NotFoundPost = {
  readonly uri: AtUri;
  readonly notFound: true;
};

/**
 * Post from blocked author
 */
export type BlockedPost = {
  readonly uri: AtUri;
  readonly blocked: true;
  readonly author: {
    readonly did: Did;
    readonly viewer?: {
      readonly blockedBy?: boolean;
      readonly blocking?: string;
    };
  };
};

/**
 * Thread view post with parent and replies
 */
export type ThreadViewPost = {
  readonly post: PostView;
  readonly parent?: ThreadViewPost | NotFoundPost | BlockedPost;
  readonly replies?: Array<ThreadViewPost | NotFoundPost | BlockedPost>;
};

/**
 * Response from getPostThread endpoint
 */
export type GetPostThreadResponse = {
  readonly thread: ThreadViewPost | NotFoundPost | BlockedPost;
  readonly threadgate?: unknown;
};

/**
 * Response from getQuotes endpoint
 */
export type GetQuotesResponse = {
  readonly uri: AtUri;
  readonly cid?: Cid;
  readonly cursor?: string;
  readonly posts: Array<PostView>;
};

/**
 * Rate limit information from response headers
 */
export type RateLimitInfo = {
  readonly limit: number;
  readonly remaining: number;
  readonly reset: number; // Unix timestamp
  readonly policy: string; // Format: "limit;w=window"
};

/**
 * API error response (reserved for future use)
 */
export type ApiError = {
  readonly error: string;
  readonly message: string;
};

/**
 * Result type for operations that can fail
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

/**
 * Mention with count and contributing posts
 */
export type MentionCount = {
  readonly mention: string;
  readonly count: number;
  readonly posts: PostView[];
};
