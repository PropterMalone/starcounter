// pattern: Functional Core
import type { ThreadViewPost, PostView, NotFoundPost, BlockedPost, Did } from '../types';

/**
 * Check if node is a valid post (not NotFound or Blocked)
 */
function isPostView(node: ThreadViewPost | NotFoundPost | BlockedPost): node is ThreadViewPost {
  return 'post' in node && !('notFound' in node) && !('blocked' in node);
}

/**
 * Thread tree structure with parent/child relationships
 */
export interface ThreadTree {
  post: PostView;
  branches: Array<ThreadTree>;
  allPosts: Array<PostView>;
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

  /**
   * Build tree from ThreadViewPost response
   * Filters out NotFoundPost and BlockedPost nodes
   */
  buildTree(root: ThreadViewPost | NotFoundPost | BlockedPost): ThreadTree {
    this.parentMap = new Map();
    this.allPostsList = [];

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

    // Add to flat list
    this.allPostsList.push(post);

    // Track parent relationship
    if (post.record.reply?.parent) {
      this.parentMap.set(post.uri, post.record.reply.parent.uri);
    }

    // Build child branches
    const branches: ThreadTree[] = [];

    if (node.replies) {
      for (const reply of node.replies) {
        // Skip NotFound and Blocked posts
        if (!isPostView(reply)) {
          continue;
        }

        const childTree = this.buildTreeRecursive(reply);
        branches.push(this.createThreadTree(childTree));
      }
    }

    return { post, branches };
  }

  /**
   * Collect all author DIDs in a branch (from post up to root)
   */
  private collectBranchAuthors(uri: string): Array<Did> {
    const authors: Array<Did> = [];
    const seen = new Set<Did>();

    // Walk up to root
    let currentUri: string | null = uri;
    while (currentUri) {
      const post = this.allPostsList.find((p) => p.uri === currentUri);
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
