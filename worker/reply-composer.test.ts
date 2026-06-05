import { describe, it, expect } from 'vitest';
import {
  composeReplyText,
  computeByteOffsets,
  buildReplyRecord,
  buildShareUrl,
} from './reply-composer';
import type { AnalysisResult } from '../src/lib/analyze';
import type { PostView } from '../src/types';
import type { MentionTarget } from './notification-poller';

function makePost(uri: string, text: string): PostView {
  return {
    uri,
    cid: `cid-${uri.split('/').pop()}`,
    author: { did: 'did:plc:user', handle: 'user.bsky.social' },
    record: { text, createdAt: '2024-01-01T00:00:00Z' },
    indexedAt: '2024-01-01T00:00:00Z',
  };
}

function makeResult(mentionCount: number): AnalysisResult {
  const mentionCounts = Array.from({ length: mentionCount }, (_, i) => ({
    mention: `Movie ${i + 1}`,
    count: 100 - i * 10,
    posts: [makePost(`at://did:plc:x/app.bsky.feed.post/p${i}`, `Movie ${i + 1}`)],
  }));

  return {
    mentionCounts,
    uncategorizedPosts: [],
    postCount: 412,
    rootPost: makePost('at://did:plc:op/app.bsky.feed.post/root', 'What is your fav movie?'),
  };
}

describe('buildShareUrl', () => {
  it('builds URL with share ID', () => {
    expect(buildShareUrl('AbCdEfGh')).toBe('https://starcounter.pages.dev/?s=AbCdEfGh');
  });
});

describe('composeReplyText', () => {
  it('includes top 5 mentions with counts', () => {
    const result = makeResult(8);
    const { text } = composeReplyText(result, 'test1234');

    expect(text).toContain('1. Movie 1 (100)');
    expect(text).toContain('5. Movie 5 (60)');
    // Should NOT include 6th
    expect(text).not.toContain('6. Movie 6');
  });

  it('shows remaining count when more than 5 mentions', () => {
    const result = makeResult(8);
    const { text } = composeReplyText(result, 'test1234');

    expect(text).toContain('...and 3 more from 412 posts');
  });

  it('shows "From N posts" when 5 or fewer mentions', () => {
    const result = makeResult(3);
    const { text } = composeReplyText(result, 'test1234');

    expect(text).toContain('From 412 posts');
    expect(text).not.toContain('...and');
  });

  it('includes share URL', () => {
    const result = makeResult(2);
    const { text, shareUrl } = composeReplyText(result, 'AbCdEfGh');

    expect(shareUrl).toBe('https://starcounter.pages.dev/?s=AbCdEfGh');
    expect(text).toContain('Full results: https://starcounter.pages.dev/?s=AbCdEfGh');
  });

  it('starts with "Results for this thread:"', () => {
    const result = makeResult(1);
    const { text } = composeReplyText(result, 'id123456');

    expect(text).toMatch(/^Results for this thread:/);
  });
});

describe('computeByteOffsets', () => {
  it('computes correct byte offsets for ASCII text', () => {
    const text = 'Hello world https://example.com end';
    const offsets = computeByteOffsets(text, 'https://example.com');

    expect(offsets).not.toBeNull();
    expect(offsets!.byteStart).toBe(12);
    expect(offsets!.byteEnd).toBe(31);
  });

  it('handles multi-byte characters before the substring', () => {
    // Each emoji is 4 bytes in UTF-8
    const text = '\u{1F600}\u{1F600} https://example.com';
    const offsets = computeByteOffsets(text, 'https://example.com');

    expect(offsets).not.toBeNull();
    // 2 emojis × 4 bytes + 1 space = 9 bytes
    expect(offsets!.byteStart).toBe(9);
    expect(offsets!.byteEnd).toBe(28);
  });

  it('returns null when substring not found', () => {
    const offsets = computeByteOffsets('hello', 'world');
    expect(offsets).toBeNull();
  });
});

describe('buildReplyRecord', () => {
  const target: MentionTarget = {
    rootUri: 'at://did:plc:op/app.bsky.feed.post/root',
    mentionUri: 'at://did:plc:user/app.bsky.feed.post/mention',
    mentionCid: 'cid-mention',
  };

  it('builds a valid post record with reply refs', () => {
    const result = makeResult(3);
    const record = buildReplyRecord(result, 'AbCdEfGh', target, 'cid-root');

    expect(record.$type).toBe('app.bsky.feed.post');
    expect(record.reply.root.uri).toBe('at://did:plc:op/app.bsky.feed.post/root');
    expect(record.reply.root.cid).toBe('cid-root');
    expect(record.reply.parent.uri).toBe('at://did:plc:user/app.bsky.feed.post/mention');
    expect(record.reply.parent.cid).toBe('cid-mention');
  });

  it('includes link facet with correct byte offsets', () => {
    const result = makeResult(2);
    const record = buildReplyRecord(result, 'AbCdEfGh', target, 'cid-root');

    expect(record.facets).toHaveLength(1);
    const facet = record.facets[0]!;
    expect(facet.features[0]!.$type).toBe('app.bsky.richtext.facet#link');
    expect(facet.features[0]!.uri).toBe('https://starcounter.pages.dev/?s=AbCdEfGh');

    // Verify byte offsets actually correspond to the URL in the text
    const encoder = new TextEncoder();
    const textBytes = encoder.encode(record.text);
    const urlBytes = textBytes.slice(facet.index.byteStart, facet.index.byteEnd);
    const decoded = new TextDecoder().decode(urlBytes);
    expect(decoded).toBe('https://starcounter.pages.dev/?s=AbCdEfGh');
  });

  it('includes createdAt timestamp', () => {
    const result = makeResult(1);
    const record = buildReplyRecord(result, 'id123456', target, 'cid-root');

    expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
