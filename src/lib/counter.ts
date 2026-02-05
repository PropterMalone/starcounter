// pattern: Functional Core
import type { PostView, ThreadTree, Did } from '../types';
import type { MediaMention } from './mention-extractor';
import { SentimentAnalyzer } from './sentiment-analyzer';

export interface MentionCount {
  title: string;
  count: number;
  posts: PostView[]; // Posts that contributed to count
}

/**
 * Smart mention counter with thread-awareness and sentiment analysis
 */
export class MentionCounter {
  private sentimentAnalyzer: SentimentAnalyzer;

  constructor() {
    this.sentimentAnalyzer = new SentimentAnalyzer();
  }

  /**
   * Count mentions across posts with smart rules:
   * - Novel mentions: +1
   * - Agreement replies with mention: +1
   * - Disagreement replies: +0
   * - Same author re-mention in branch: +0
   * - Separate branches: independent counting
   */
  countMentions(
    mentions: MediaMention[],
    posts: PostView[],
    tree: ThreadTree
  ): Map<string, number> {
    const counts = new Map<string, number>();

    // Track which authors have mentioned each title in each branch
    const branchMentions = new Map<string, Map<string, Set<Did>>>();

    for (const post of posts) {
      const postMentions = this.extractMentionsFromPost(post, mentions);

      for (const mention of postMentions) {
        const normalized = mention.normalizedTitle;

        // Get branch root (top-most ancestor)
        const branchRoot = this.getBranchRoot(post.uri, tree);

        // Initialize branch tracking
        if (!branchMentions.has(branchRoot)) {
          branchMentions.set(branchRoot, new Map());
        }
        const branchMap = branchMentions.get(branchRoot)!;

        if (!branchMap.has(normalized)) {
          branchMap.set(normalized, new Set());
        }
        const authorsWhoMentioned = branchMap.get(normalized)!;

        // Rule 1: Same author already mentioned in this branch → skip
        if (authorsWhoMentioned.has(post.author.did)) {
          continue;
        }

        // Rule 2: Check if this is a reply with sentiment
        const parent = tree.getParent(post.uri);
        if (parent) {
          // Get parent post
          const parentPost = tree.allPosts.find((p) => p.uri === parent);
          if (parentPost) {
            const parentMentions = this.extractMentionsFromPost(parentPost, mentions);
            const parentHasMention = parentMentions.some((m) => m.normalizedTitle === normalized);

            if (parentHasMention) {
              // Parent mentioned it, check sentiment of current post
              const isAgreement = this.sentimentAnalyzer.isAgreement(post.record.text);

              if (!isAgreement) {
                // Disagreement → don't count
                continue;
              }
              // Agreement → count below
            }
          }
        }

        // Count this mention
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
        authorsWhoMentioned.add(post.author.did);
      }
    }

    return counts;
  }

  /**
   * Extract mentions from a single post
   */
  private extractMentionsFromPost(post: PostView, allMentions: MediaMention[]): MediaMention[] {
    return allMentions.filter((mention) => {
      const text = post.record.text.toLowerCase();
      return text.includes(mention.normalizedTitle);
    });
  }

  /**
   * Get the branch root (top-most post in the branch)
   */
  private getBranchRoot(uri: string, tree: ThreadTree): string {
    let current = uri;
    let parent = tree.getParent(current);

    while (parent) {
      current = parent;
      parent = tree.getParent(current);
    }

    return current;
  }
}
