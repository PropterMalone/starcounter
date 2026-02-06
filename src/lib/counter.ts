// pattern: Functional Core
import type { PostView, Did } from '../types';
import type { ThreadTree } from './thread-builder';
import type { MediaMention } from './mention-extractor';
import { SentimentAnalyzer, type SentimentResult } from './sentiment-analyzer';

export interface MentionCount {
  title: string;
  count: number;
  posts: PostView[]; // Posts that contributed to count
}

/**
 * Interface for sentiment analyzers (supports both sync and async)
 */
export type SentimentAnalyzerLike = {
  analyze(text: string): SentimentResult | Promise<SentimentResult>;
  isAgreement(text: string): boolean | Promise<boolean>;
};

/**
 * Smart mention counter with thread-awareness and sentiment analysis
 */
export class MentionCounter {
  private sentimentAnalyzer: SentimentAnalyzerLike;

  constructor(sentimentAnalyzer?: SentimentAnalyzerLike) {
    this.sentimentAnalyzer = sentimentAnalyzer ?? new SentimentAnalyzer();
  }

  /**
   * Set the sentiment analyzer (for switching between basic and advanced)
   */
  setSentimentAnalyzer(analyzer: SentimentAnalyzerLike): void {
    this.sentimentAnalyzer = analyzer;
  }

  /**
   * Count mentions across posts with smart rules:
   * - Novel mentions: +1
   * - Agreement replies with mention: +1
   * - Disagreement replies: +0
   * - Same author re-mention in branch: +0
   * - Separate branches: independent counting
   *
   * Note: This method is async to support both sync and async sentiment analyzers.
   */
  async countMentions(
    mentions: MediaMention[],
    posts: PostView[],
    tree: ThreadTree
  ): Promise<Map<string, number>> {
    // Build canonical title mapping: short variants → longest containing title
    // This ensures "red", "red october" → "hunt for red october"
    const canonicalMap = this.buildCanonicalTitleMap(mentions);

    const counts = new Map<string, number>();

    // Build post lookup map for O(1) access instead of O(n) find()
    const postByUri = new Map<string, PostView>(tree.allPosts.map((p) => [p.uri, p]));

    // Track which authors have mentioned each title in each branch
    const branchMentions = new Map<string, Map<string, Set<Did>>>();

    for (const post of posts) {
      // Use original mentions for matching, but map to canonical titles for counting
      const postMentions = this.extractMentionsFromPost(post, mentions);

      for (const mention of postMentions) {
        const normalized = mention.normalizedTitle;
        // Map to canonical title for consistent tracking
        const canonical = canonicalMap.get(normalized) ?? normalized;

        // Get branch root (top-most ancestor)
        const branchRoot = this.getBranchRoot(post.uri, tree);

        // Initialize branch tracking
        if (!branchMentions.has(branchRoot)) {
          branchMentions.set(branchRoot, new Map());
        }
        const branchMap = branchMentions.get(branchRoot)!;

        if (!branchMap.has(canonical)) {
          branchMap.set(canonical, new Set());
        }
        const authorsWhoMentioned = branchMap.get(canonical)!;

        // Rule 1: Same author already mentioned in this branch → skip
        if (authorsWhoMentioned.has(post.author.did)) {
          continue;
        }

        // Rule 2: Check if this is a reply with sentiment
        const parent = tree.getParent(post.uri);
        if (parent) {
          // Get parent post using O(1) map lookup instead of O(n) find
          const parentPost = postByUri.get(parent);
          if (parentPost) {
            const parentMentions = this.extractMentionsFromPost(parentPost, mentions);
            // Check if parent mentioned this title (or any variant mapping to same canonical)
            const parentHasMention = parentMentions.some(
              (m) => (canonicalMap.get(m.normalizedTitle) ?? m.normalizedTitle) === canonical
            );

            if (parentHasMention) {
              // Parent mentioned it, check sentiment of current post
              // Await to support both sync and async analyzers
              const isAgreement = await this.sentimentAnalyzer.isAgreement(post.record.text);

              if (!isAgreement) {
                // Disagreement → don't count
                continue;
              }
              // Agreement → count below
            }
          }
        }

        // Count this mention using canonical title
        counts.set(canonical, (counts.get(canonical) || 0) + 1);
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
   * Build a map from each normalized title to its canonical (longest) form.
   * If "red", "red october", and "hunt for red october" all exist,
   * they all map to "hunt for red october".
   */
  private buildCanonicalTitleMap(mentions: MediaMention[]): Map<string, string> {
    // Get unique normalized titles
    const uniqueTitles = [...new Set(mentions.map((m) => m.normalizedTitle))];

    // Sort by length descending (longest first)
    uniqueTitles.sort((a, b) => b.length - a.length);

    // Build canonical mapping: each title → longest containing title
    const canonicalMap = new Map<string, string>();

    for (const title of uniqueTitles) {
      // Check if this title is a word-bounded substring of a longer title
      let canonical = title;
      for (const longer of uniqueTitles) {
        if (longer.length > title.length) {
          const pattern = new RegExp(`\\b${this.escapeRegex(title)}\\b`, 'i');
          if (pattern.test(longer)) {
            canonical = longer;
            break; // Use the longest one (they're sorted by length desc)
          }
        }
      }
      canonicalMap.set(title, canonical);
    }

    return canonicalMap;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
