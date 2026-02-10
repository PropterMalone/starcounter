// pattern: Functional Core
// Extract all text content from a PostView, including embed data.

import type { AtUri, PostView } from '../types';

export type EmbedLink = {
  readonly url: string;
  readonly title: string;
  readonly platform: 'youtube' | 'spotify' | 'apple' | 'soundcloud' | 'bandcamp' | 'unknown';
};

export type PostTextContent = {
  readonly ownText: string; // record.text + own image alt text
  readonly quotedText: string | null;
  readonly quotedUri: string | null;
  readonly quotedAltText: readonly string[] | null;
  readonly embedLinks: readonly EmbedLink[];
  readonly searchText: string; // combined text for candidate extraction
};

// Type guards for embed shapes (embed is typed as unknown)

type ImageLike = { readonly alt?: string };

function getImages(obj: unknown): readonly ImageLike[] {
  if (!obj || typeof obj !== 'object') return [];
  const results: ImageLike[] = [];
  const o = obj as Record<string, unknown>;

  // Direct images array
  if (Array.isArray(o['images'])) {
    results.push(...(o['images'] as ImageLike[]));
  }
  // Nested media.images
  if (o['media'] && typeof o['media'] === 'object') {
    const media = o['media'] as Record<string, unknown>;
    if (Array.isArray(media['images'])) {
      results.push(...(media['images'] as ImageLike[]));
    }
  }
  return results;
}

function getEmbedType(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  return typeof o['$type'] === 'string' ? o['$type'] : null;
}

/** Extract all text from a post's own content, including image alt text. */
function extractOwnText(post: PostView): string {
  const parts: string[] = [];
  const text = post.record.text;
  if (text) parts.push(text);

  // Collect alt text from both record-level and view-level embeds
  const seen = new Set<string>();
  for (const embed of [post.record.embed, post.embed]) {
    for (const img of getImages(embed)) {
      const alt = img.alt;
      if (alt && !seen.has(alt)) {
        seen.add(alt);
        parts.push(`[image alt: ${alt}]`);
      }
    }
  }

  return parts.join('\n');
}

/** Extract text from a quoted/embedded post. */
function extractQuotedPostText(post: PostView): string | null {
  const embed = post.embed;
  if (!embed || typeof embed !== 'object') return null;
  const e = embed as Record<string, unknown>;
  const type = getEmbedType(embed);

  if (type === 'app.bsky.embed.record#view') {
    const record = e['record'] as Record<string, unknown> | undefined;
    const value = record?.['value'] as Record<string, unknown> | undefined;
    if (typeof value?.['text'] === 'string') return value['text'];
  }

  if (type === 'app.bsky.embed.recordWithMedia#view') {
    const record = e['record'] as Record<string, unknown> | undefined;
    const inner = record?.['record'] as Record<string, unknown> | undefined;
    const value = inner?.['value'] as Record<string, unknown> | undefined;
    if (typeof value?.['text'] === 'string') return value['text'];
  }

  return null;
}

/** Extract the URI of a quoted post. */
function extractQuotedPostUri(post: PostView): AtUri | null {
  const embed = post.embed;
  if (!embed || typeof embed !== 'object') return null;
  const e = embed as Record<string, unknown>;
  const type = getEmbedType(embed);

  if (type === 'app.bsky.embed.record#view') {
    const record = e['record'] as Record<string, unknown> | undefined;
    if (typeof record?.['uri'] === 'string') return record['uri'];
  }

  if (type === 'app.bsky.embed.recordWithMedia#view') {
    const record = e['record'] as Record<string, unknown> | undefined;
    const inner = record?.['record'] as Record<string, unknown> | undefined;
    if (typeof inner?.['uri'] === 'string') return inner['uri'];
  }

  return null;
}

/** Extract alt text from a quoted post's images. */
function extractQuotedPostAltText(post: PostView): readonly string[] | null {
  const embed = post.embed;
  if (!embed || typeof embed !== 'object') return null;
  const e = embed as Record<string, unknown>;
  const type = getEmbedType(embed);

  const alts: string[] = [];

  if (type === 'app.bsky.embed.recordWithMedia#view') {
    // Media is on the outer embed
    const media = e['media'] as Record<string, unknown> | undefined;
    if (media && Array.isArray(media['images'])) {
      for (const img of media['images'] as ImageLike[]) {
        if (img.alt) alts.push(img.alt);
      }
    }
    return alts.length > 0 ? alts : null;
  }

  // For record embeds, check the quoted record's embeds for images
  if (type === 'app.bsky.embed.record#view') {
    const record = e['record'] as Record<string, unknown> | undefined;
    if (record && Array.isArray(record['embeds'])) {
      for (const innerEmbed of record['embeds'] as unknown[]) {
        for (const img of getImages(innerEmbed)) {
          if (img.alt) alts.push(img.alt);
        }
      }
    }
    return alts.length > 0 ? alts : null;
  }

  return null;
}

/** Detect music/video platform from URL hostname. */
function detectPlatform(url: string): EmbedLink['platform'] {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
    if (hostname.includes('spotify.com')) return 'spotify';
    if (hostname.includes('music.apple.com') || hostname.includes('itunes.apple.com'))
      return 'apple';
    if (hostname.includes('soundcloud.com')) return 'soundcloud';
    if (hostname.includes('bandcamp.com')) return 'bandcamp';
  } catch {
    // Invalid URL — fall through
  }
  return 'unknown';
}

type ExternalLike = { readonly uri?: string; readonly title?: string };

/** Extract link data from an embed's external field. */
function extractExternalLink(external: ExternalLike): EmbedLink | null {
  if (!external.uri || !external.title) return null;
  const title = external.title.trim();
  if (title.length === 0) return null;
  return {
    url: external.uri,
    title,
    platform: detectPlatform(external.uri),
  };
}

/** Extract all external embed links from a post's view embed. */
export function extractEmbedLinks(post: PostView): EmbedLink[] {
  const embed = post.embed;
  if (!embed || typeof embed !== 'object') return [];
  const e = embed as Record<string, unknown>;
  const links: EmbedLink[] = [];

  // Direct external embed: app.bsky.embed.external#view
  if (e['external'] && typeof e['external'] === 'object') {
    const link = extractExternalLink(e['external'] as ExternalLike);
    if (link) links.push(link);
  }

  // Media external in recordWithMedia: app.bsky.embed.recordWithMedia#view
  if (e['media'] && typeof e['media'] === 'object') {
    const media = e['media'] as Record<string, unknown>;
    if (media['external'] && typeof media['external'] === 'object') {
      const link = extractExternalLink(media['external'] as ExternalLike);
      if (link) links.push(link);
    }
  }

  return links;
}

/** Extract all text content from a post for analysis. */
export function extractPostText(post: PostView): PostTextContent {
  const ownText = extractOwnText(post);
  const quotedText = extractQuotedPostText(post);
  const quotedUri = extractQuotedPostUri(post);
  const quotedAltText = extractQuotedPostAltText(post);
  const embedLinks = extractEmbedLinks(post);

  // Build combined search text
  const parts = [ownText];
  if (quotedText) parts.push(quotedText);
  if (quotedAltText) parts.push(quotedAltText.join('\n'));
  const searchText = parts.join('\n');

  return { ownText, quotedText, quotedUri, quotedAltText, embedLinks, searchText };
}
