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
  });
});
