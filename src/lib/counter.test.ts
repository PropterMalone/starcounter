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
    it('should count novel mentions', () => {
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

      const counts = counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(1);
    });

    it('should count agreement replies', () => {
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

      const counts = counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(2); // Original + agreement
    });

    it('should not count disagreement replies', () => {
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

      const counts = counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(1); // Only original, disagreement not counted
    });

    it('should not count same author re-mentions in same branch', () => {
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
        getBranchAuthors: (uri) => ['user1'],
      };

      const counts = counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(1); // Same author, same branch
    });

    it('should count separately across different branches', () => {
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

      const counts = counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(2); // Both branches count separately
    });

    it('should handle posts with no mentions', () => {
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

      const counts = counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBeUndefined();
    });

    it('should handle empty posts list', () => {
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

      const counts = counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.size).toBe(0);
    });

    it('should handle multiple mentions in single post', () => {
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

      const counts = counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(1);
      expect(counts.get('inception')).toBe(1);
    });

    it('should handle reply to post without mention', () => {
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

      const counts = counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(1); // Only in post2, not in parent
    });

    it('should handle missing parent post in tree', () => {
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

      const counts = counter.countMentions(mentions, posts, tree as ThreadTree);

      // post2 mentions matrix and agrees, but parent doesn't exist in allPosts
      // so it counts as a novel mention
      expect(counts.get('matrix')).toBe(2);
    });

    it('should handle agreement in nested replies', () => {
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

      const counts = counter.countMentions(mentions, posts, tree as ThreadTree);

      // post1: counts matrix (+1)
      // post2: replies to post1 but doesn't mention matrix (0)
      // post3: replies to post2 (agrees and mentions matrix, but post2 doesn't have matrix, so counts as novel +1)
      expect(counts.get('matrix')).toBe(2);
    });
  });
});
