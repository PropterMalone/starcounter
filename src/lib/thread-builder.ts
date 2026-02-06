// pattern: Functional Core
import type { ThreadViewPost, PostView, NotFoundPost, BlockedPost, RestrictedPost, Did } from '../types';

/**
 * Check if node is a valid post (not NotFound, Blocked, or Restricted)
 */
function isPostView(
  node: ThreadViewPost | NotFoundPost | BlockedPost | RestrictedPost
): node is ThreadViewPost {
  return 'post' in node && !('notFound' in node) && !('blocked' in node) && !('restricted' in node);
}

/**
 * Check if node is a restricted post (requires authentication)
 */
function isRestrictedPost(
  node: ThreadViewPost | NotFoundPost | BlockedPost | RestrictedPost
): node is RestrictedPost {
  return 'restricted' in node && node.restricted === true;
}

/**
 * Post with truncated replies (replyCount > actual replies returned)
 */
export interface TruncatedPost {
  uri: string;
  expectedReplies: number;
  actualReplies: number;
}

/**
 * Thread tree structure with parent/child relationships
 */
export interface ThreadTree {
  post: PostView;
  branches: Array<ThreadTree>;
  allPosts: Array<PostView>;
  truncatedPosts: Array<TruncatedPost>;
  restrictedPosts: Array<RestrictedPost>;
  getParent(uri: string): string | null;
  getBranchAuthors(uri: string): Array<Did>;
  flattenPosts(): Array<PostView>;
}

/**
 * Internal tree node structure for building
 */
interface TreeNode {
  post: PostView;
  branches: Array<ThreadTree>;
}

/**
 * Builds thread tree structure from flat post list
 * Identifies branches and parent/child relationships
 */
export class ThreadBuilder {
  private parentMap: Map<string, string> = new Map();
  private allPostsList: Array<PostView> = [];
  private postByUri: Map<string, PostView> = new Map(); // O(1) lookup by URI
  private truncatedPostsList: Array<TruncatedPost> = [];
  private restrictedPostsList: Array<RestrictedPost> = [];

  /**
   * Build tree from ThreadViewPost response
   * Filters out NotFoundPost, BlockedPost, and RestrictedPost nodes
   */
  buildTree(root: ThreadViewPost | NotFoundPost | BlockedPost | RestrictedPost): ThreadTree {
    this.parentMap = new Map();
    this.allPostsList = [];
    this.postByUri = new Map();
    this.truncatedPostsList = [];
    this.restrictedPostsList = [];

    // Handle restricted root
    if (isRestrictedPost(root)) {
      throw new Error('Root post requires authentication to view');
    }

    // Handle NotFound/Blocked root
    if (!isPostView(root)) {
      throw new Error('Root post is not available (deleted or blocked)');
    }

    const tree = this.buildTreeRecursive(root);

    return this.createThreadTree(tree);
  }

  /**
   * Create a ThreadTree object with bound methods
   */
  private createThreadTree(node: TreeNode): ThreadTree {
    return {
      post: node.post,
      branches: node.branches,
      allPosts: this.allPostsList,
      truncatedPosts: this.truncatedPostsList,
      restrictedPosts: this.restrictedPostsList,
      getParent: (uri: string) => this.parentMap.get(uri) ?? null,
      getBranchAuthors: (uri: string) => this.collectBranchAuthors(uri),
      flattenPosts: () => this.flattenPostsRecursive(node),
    };
  }

  /**
   * Recursive tree builder
   */
  private buildTreeRecursive(node: ThreadViewPost): TreeNode {
    const post = node.post;

    // Add to flat list and lookup map
    this.allPostsList.push(post);
    this.postByUri.set(post.uri, post);

    // Track parent relationship
    if (post.record.reply?.parent) {
      this.parentMap.set(post.uri, post.record.reply.parent.uri);
    }

    // Build child branches
    const branches: ThreadTree[] = [];
    const actualReplies = node.replies?.filter(isPostView).length ?? 0;

    if (node.replies) {
      for (const reply of node.replies) {
        // Track restricted posts
        if (isRestrictedPost(reply)) {
          this.restrictedPostsList.push(reply);
          continue;
        }

        // Skip NotFound and Blocked posts
        if (!isPostView(reply)) {
          continue;
        }

        const childTree = this.buildTreeRecursive(reply);
        branches.push(this.createThreadTree(childTree));
      }
    }

    // Detect truncation: API returned fewer replies than post.replyCount indicates
    const expectedReplies = post.replyCount ?? 0;
    if (expectedReplies > actualReplies) {
      this.truncatedPostsList.push({
        uri: post.uri,
        expectedReplies,
        actualReplies,
      });
    }

    return { post, branches };
  }

  /**
   * Collect all author DIDs in a branch (from post up to root)
   */
  private collectBranchAuthors(uri: string): Array<Did> {
    const authors: Array<Did> = [];
    const seen = new Set<Did>();

    // Walk up to root using O(1) map lookup instead of O(n) find
    let currentUri: string | null = uri;
    while (currentUri) {
      const post = this.postByUri.get(currentUri);
      if (post && !seen.has(post.author.did)) {
        authors.push(post.author.did);
        seen.add(post.author.did);
      }
      currentUri = this.parentMap.get(currentUri) ?? null;
    }

    return authors;
  }

  /**
   * Flatten tree to post list (depth-first)
   */
  private flattenPostsRecursive(tree: {
    post: PostView;
    branches: Array<ThreadTree>;
  }): Array<PostView> {
    const posts: Array<PostView> = [tree.post];

    for (const branch of tree.branches) {
      posts.push(...this.flattenPostsRecursive(branch));
    }

    return posts;
  }
}
