import { describe, it, expect } from 'vitest';
import { ThreadBuilder } from './thread-builder';
import type { ThreadViewPost, PostView, NotFoundPost } from '../types';

describe('ThreadBuilder', () => {
  const createMockPost = (uri: string, text: string, replyTo?: string): PostView => ({
    uri,
    cid: `cid_${uri}`,
    author: {
      did: 'did:plc:test',
      handle: 'test.bsky.social',
    },
    record: {
      text,
      createdAt: new Date().toISOString(),
      ...(replyTo && {
        reply: {
          root: { uri: 'root_uri', cid: 'root_cid' },
          parent: { uri: replyTo, cid: `cid_${replyTo}` },
        },
      }),
    },
    indexedAt: new Date().toISOString(),
  });

  describe('buildTree', () => {
    it('should handle single post with no replies', () => {
      const rootPost: ThreadViewPost = {
        post: createMockPost('post1', 'Root post'),
      };

      const builder = new ThreadBuilder();
      const tree = builder.buildTree(rootPost);

      expect(tree.post.uri).toBe('post1');
      expect(tree.branches).toHaveLength(0);
      expect(tree.allPosts).toHaveLength(1);
    });

    it('should build tree with direct replies', () => {
      const rootPost: ThreadViewPost = {
        post: createMockPost('post1', 'Root post'),
        replies: [
          {
            post: createMockPost('post2', 'Reply 1', 'post1'),
          },
          {
            post: createMockPost('post3', 'Reply 2', 'post1'),
          },
        ],
      };

      const builder = new ThreadBuilder();
      const tree = builder.buildTree(rootPost);

      expect(tree.post.uri).toBe('post1');
      expect(tree.branches).toHaveLength(2);
      expect(tree.allPosts).toHaveLength(3);
      expect(tree.branches[0].post.uri).toBe('post2');
      expect(tree.branches[1].post.uri).toBe('post3');
    });

    it('should build tree with nested replies', () => {
      const rootPost: ThreadViewPost = {
        post: createMockPost('post1', 'Root post'),
        replies: [
          {
            post: createMockPost('post2', 'Reply 1', 'post1'),
            replies: [
              {
                post: createMockPost('post3', 'Nested reply', 'post2'),
              },
            ],
          },
        ],
      };

      const builder = new ThreadBuilder();
      const tree = builder.buildTree(rootPost);

      expect(tree.allPosts).toHaveLength(3);
      expect(tree.branches).toHaveLength(1);
      expect(tree.branches[0].branches).toHaveLength(1);
      expect(tree.branches[0].branches[0].post.uri).toBe('post3');
    });

    it('should handle NotFoundPost nodes', () => {
      const notFound: NotFoundPost = {
        uri: 'deleted_post',
        notFound: true,
      };

      const rootPost: ThreadViewPost = {
        post: createMockPost('post1', 'Root post'),
        replies: [notFound],
      };

      const builder = new ThreadBuilder();
      const tree = builder.buildTree(rootPost);

      expect(tree.allPosts).toHaveLength(1); // Only root, not NotFound
      expect(tree.branches).toHaveLength(0);
    });

    it('should track parent-child relationships', () => {
      const rootPost: ThreadViewPost = {
        post: createMockPost('post1', 'Root'),
        replies: [
          {
            post: createMockPost('post2', 'Reply', 'post1'),
          },
        ],
      };

      const builder = new ThreadBuilder();
      const tree = builder.buildTree(rootPost);

      expect(tree.getParent('post2')).toBe('post1');
      expect(tree.getParent('post1')).toBeNull();
    });

    it('should identify branch authors', () => {
      const rootPost: ThreadViewPost = {
        post: {
          ...createMockPost('post1', 'Root'),
          author: { did: 'did:user1', handle: 'user1.bsky.social' },
        },
        replies: [
          {
            post: {
              ...createMockPost('post2', 'Reply', 'post1'),
              author: { did: 'did:user2', handle: 'user2.bsky.social' },
            },
          },
        ],
      };

      const builder = new ThreadBuilder();
      const tree = builder.buildTree(rootPost);

      const authors = tree.getBranchAuthors('post2');
      expect(authors).toContain('did:user1');
      expect(authors).toContain('did:user2');
    });
  });

  describe('flattenPosts', () => {
    it('should flatten nested tree to post list', () => {
      const rootPost: ThreadViewPost = {
        post: createMockPost('post1', 'Root'),
        replies: [
          {
            post: createMockPost('post2', 'Reply', 'post1'),
            replies: [
              {
                post: createMockPost('post3', 'Nested', 'post2'),
              },
            ],
          },
        ],
      };

      const builder = new ThreadBuilder();
      const tree = builder.buildTree(rootPost);
      const flattened = tree.flattenPosts();

      expect(flattened).toHaveLength(3);
      expect(flattened.map((p) => p.uri)).toEqual(['post1', 'post2', 'post3']);
    });
  });
});
