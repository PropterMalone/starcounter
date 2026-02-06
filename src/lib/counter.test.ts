import { describe, it, expect } from 'vitest';
import { MentionCounter } from './counter';
import type { PostView, ThreadTree } from '../types';
import type { MediaMention } from './mention-extractor';

describe('MentionCounter', () => {
  const counter = new MentionCounter();

  const createPost = (uri: string, author: string, text: string): PostView => ({
    uri,
    cid: `cid_${uri}`,
    author: { did: author, handle: `${author}.bsky.social` },
    record: { text, createdAt: new Date().toISOString() },
    indexedAt: new Date().toISOString(),
  });

  describe('countMentions', () => {
    it('should count novel mentions', async () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [createPost('post1', 'user1', 'I watched The Matrix')];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: () => null,
        getBranchAuthors: () => ['user1'],
      };

      const counts = await counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(1);
    });

    it('should count agreement replies', async () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [
        createPost('post1', 'user1', 'I watched The Matrix'),
        createPost('post2', 'user2', 'I totally agree! The Matrix is amazing.'),
      ];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: (uri) => (uri === 'post2' ? 'post1' : null),
        getBranchAuthors: (uri) => (uri === 'post2' ? ['user1', 'user2'] : ['user1']),
      };

      const counts = await counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(2); // Original + agreement
    });

    it('should not count disagreement replies', async () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [
        createPost('post1', 'user1', 'I watched The Matrix'),
        createPost('post2', 'user2', 'I disagree. The Matrix was not good.'),
      ];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: (uri) => (uri === 'post2' ? 'post1' : null),
        getBranchAuthors: (uri) => (uri === 'post2' ? ['user1', 'user2'] : ['user1']),
      };

      const counts = await counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(1); // Only original, disagreement not counted
    });

    it('should not count same author re-mentions in same branch', async () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [
        createPost('post1', 'user1', 'I watched The Matrix'),
        createPost('post2', 'user1', 'The Matrix is still my favorite'),
      ];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: (uri) => (uri === 'post2' ? 'post1' : null),
        getBranchAuthors: (_uri) => ['user1'],
      };

      const counts = await counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(1); // Same author, same branch
    });

    it('should count separately across different branches', async () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [
        createPost('root', 'user1', 'What movie?'),
        createPost('branch1', 'user2', 'The Matrix'),
        createPost('branch2', 'user3', 'The Matrix'),
      ];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: (uri) => (uri === 'branch1' || uri === 'branch2' ? 'root' : null),
        getBranchAuthors: (uri) => {
          if (uri === 'branch1') return ['user1', 'user2'];
          if (uri === 'branch2') return ['user1', 'user3'];
          return ['user1'];
        },
      };

      const counts = await counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(2); // Both branches count separately
    });

    it('should handle posts with no mentions', async () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [
        createPost('post1', 'user1', 'Just a regular post'),
        createPost('post2', 'user2', 'Nothing to see here'),
      ];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: () => null,
        getBranchAuthors: () => ['user1', 'user2'],
      };

      const counts = await counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBeUndefined();
    });

    it('should handle empty posts list', async () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: () => null,
        getBranchAuthors: () => [],
      };

      const counts = await counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.size).toBe(0);
    });

    it('should handle multiple mentions in single post', async () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
        {
          title: 'Inception',
          normalizedTitle: 'inception',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [
        createPost('post1', 'user1', 'I watched The Matrix and Inception'),
      ];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: () => null,
        getBranchAuthors: () => ['user1'],
      };

      const counts = await counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(1);
      expect(counts.get('inception')).toBe(1);
    });

    it('should handle reply to post without mention', async () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [
        createPost('post1', 'user1', 'Great movie!'),
        createPost('post2', 'user2', 'I totally agree! The Matrix is amazing.'),
      ];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: (uri) => (uri === 'post2' ? 'post1' : null),
        getBranchAuthors: (uri) => (uri === 'post2' ? ['user1', 'user2'] : ['user1']),
      };

      const counts = await counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(1); // Only in post2, not in parent
    });

    it('should handle missing parent post in tree', async () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [
        createPost('post1', 'user1', 'I watched The Matrix'),
        createPost('post2', 'user2', 'I totally agree! The Matrix is amazing.'),
      ];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: (uri) => (uri === 'post2' ? 'nonexistent' : null),
        getBranchAuthors: (uri) => (uri === 'post2' ? ['user1', 'user2'] : ['user1']),
      };

      const counts = await counter.countMentions(mentions, posts, tree as ThreadTree);

      // post2 mentions matrix and agrees, but parent doesn't exist in allPosts
      // so it counts as a novel mention
      expect(counts.get('matrix')).toBe(2);
    });

    it('should handle agreement in nested replies', async () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [
        createPost('post1', 'user1', 'I watched The Matrix'),
        createPost('post2', 'user2', 'So good!'),
        createPost('post3', 'user3', 'I agree! The Matrix is amazing.'),
      ];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: (uri) => {
          if (uri === 'post2') return 'post1';
          if (uri === 'post3') return 'post2';
          return null;
        },
        getBranchAuthors: () => ['user1', 'user2', 'user3'],
      };

      const counts = await counter.countMentions(mentions, posts, tree as ThreadTree);

      // post1: counts matrix (+1)
      // post2: replies to post1 but doesn't mention matrix (0)
      // post3: replies to post2 (agrees and mentions matrix, but post2 doesn't have matrix, so counts as novel +1)
      expect(counts.get('matrix')).toBe(2);
    });

    it('should merge variant titles to canonical form', async () => {
      // Simulates: "RED" and "Hunt for Red October" extracted from different posts
      // Both should count towards "hunt for red october"
      const mentions: MediaMention[] = [
        {
          title: 'Hunt for Red October',
          normalizedTitle: 'hunt for red october',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
        {
          title: 'RED',
          normalizedTitle: 'red',
          mediaType: 'MOVIE',
          confidence: 'medium',
        },
        {
          title: 'Red October',
          normalizedTitle: 'red october',
          mediaType: 'MOVIE',
          confidence: 'medium',
        },
      ];

      const posts: PostView[] = [
        createPost('post1', 'user1', 'Hunt for Red October is great'),
        createPost('post2', 'user2', 'I love RED'),
        createPost('post3', 'user3', 'Red October is a classic'),
      ];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: () => null,
        getBranchAuthors: () => ['user1', 'user2', 'user3'],
      };

      const counts = await counter.countMentions(mentions, posts, tree as ThreadTree);

      // All three should be merged into "hunt for red october"
      expect(counts.get('hunt for red october')).toBe(3);
      expect(counts.get('red')).toBeUndefined();
      expect(counts.get('red october')).toBeUndefined();
    });

    it('should merge Indiana Jones variants', async () => {
      const mentions: MediaMention[] = [
        {
          title: 'Indiana Jones',
          normalizedTitle: 'indiana jones',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
        {
          title: 'JONES',
          normalizedTitle: 'jones',
          mediaType: 'MOVIE',
          confidence: 'low',
        },
      ];

      const posts: PostView[] = [
        createPost('post1', 'user1', 'Indiana Jones is my favorite'),
        createPost('post2', 'user2', 'JONES is iconic'),
      ];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: () => null,
        getBranchAuthors: () => ['user1', 'user2'],
      };

      const counts = await counter.countMentions(mentions, posts, tree as ThreadTree);

      // Both should be merged into "indiana jones"
      expect(counts.get('indiana jones')).toBe(2);
      expect(counts.get('jones')).toBeUndefined();
    });

    it('should keep unrelated titles separate', async () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
        {
          title: 'Inception',
          normalizedTitle: 'inception',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [
        createPost('post1', 'user1', 'The Matrix is great'),
        createPost('post2', 'user2', 'Inception is better'),
      ];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: () => null,
        getBranchAuthors: () => ['user1', 'user2'],
      };

      const counts = await counter.countMentions(mentions, posts, tree as ThreadTree);

      // Unrelated titles should remain separate
      expect(counts.get('matrix')).toBe(1);
      expect(counts.get('inception')).toBe(1);
    });
  });
});
