// Compose Bluesky reply posts with text summary and clickable link facet.
// Handles UTF-8 byte offset computation for Bluesky's facet system.

import type { AnalysisResult } from '../src/lib/analyze';
import type { MentionTarget } from './notification-poller';

const MAX_TOP_MENTIONS = 5;
const SITE_URL = 'https://starcounter.pages.dev';

export type ReplyFacet = {
  readonly index: { readonly byteStart: number; readonly byteEnd: number };
  readonly features: ReadonlyArray<{ readonly $type: string; readonly uri: string }>;
};

export type ReplyRecord = {
  readonly $type: 'app.bsky.feed.post';
  readonly text: string;
  readonly facets: readonly ReplyFacet[];
  readonly reply: {
    readonly root: { readonly uri: string; readonly cid: string };
    readonly parent: { readonly uri: string; readonly cid: string };
  };
  readonly createdAt: string;
};

/** Build the share URL for a given share ID. */
export function buildShareUrl(shareId: string): string {
  return `${SITE_URL}/?s=${shareId}`;
}

/** Compose reply text with top mentions summary and share link. */
export function composeReplyText(
  result: AnalysisResult,
  shareId: string
): { text: string; shareUrl: string } {
  const lines: string[] = [];
  lines.push('Results for this thread:\n');

  const topMentions = result.mentionCounts.slice(0, MAX_TOP_MENTIONS);
  for (let i = 0; i < topMentions.length; i++) {
    const mc = topMentions[i]!;
    lines.push(`${i + 1}. ${mc.mention} (${mc.count})`);
  }

  const remaining = result.mentionCounts.length - topMentions.length;
  if (remaining > 0) {
    lines.push(`\n...and ${remaining} more from ${result.postCount} posts`);
  } else {
    lines.push(`\nFrom ${result.postCount} posts`);
  }

  const shareUrl = buildShareUrl(shareId);
  lines.push(`\nFull results: ${shareUrl}`);

  return { text: lines.join('\n'), shareUrl };
}

/** Compute UTF-8 byte offsets for a substring within text. */
export function computeByteOffsets(
  text: string,
  substring: string
): { byteStart: number; byteEnd: number } | null {
  const idx = text.indexOf(substring);
  if (idx === -1) return null;

  const encoder = new TextEncoder();
  const byteStart = encoder.encode(text.slice(0, idx)).byteLength;
  const byteEnd = byteStart + encoder.encode(substring).byteLength;
  return { byteStart, byteEnd };
}

/** Build a complete reply record for com.atproto.repo.createRecord. */
export function buildReplyRecord(
  result: AnalysisResult,
  shareId: string,
  target: MentionTarget,
  rootCid: string
): ReplyRecord {
  const { text, shareUrl } = composeReplyText(result, shareId);
  const offsets = computeByteOffsets(text, shareUrl);

  const facets: ReplyFacet[] = offsets
    ? [
        {
          index: { byteStart: offsets.byteStart, byteEnd: offsets.byteEnd },
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: shareUrl }],
        },
      ]
    : [];

  return {
    $type: 'app.bsky.feed.post',
    text,
    facets,
    reply: {
      root: { uri: target.rootUri, cid: rootCid },
      parent: { uri: target.mentionUri, cid: target.mentionCid },
    },
    createdAt: new Date().toISOString(),
  };
}
