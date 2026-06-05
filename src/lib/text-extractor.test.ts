import { describe, it, expect } from 'vitest';
import { extractPostText, extractEmbedLinks } from './text-extractor';
import type { PostView } from '../types';

function makePost(overrides: Partial<PostView> = {}): PostView {
  return {
    uri: 'at://did:plc:test/app.bsky.feed.post/abc',
    cid: 'cid-test',
    author: {
      did: 'did:plc:test',
      handle: 'test.bsky.social',
    },
    record: {
      text: 'Hello world',
      createdAt: '2024-01-01T00:00:00Z',
    },
    indexedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('extractPostText', () => {
  it('extracts plain text from a simple post', () => {
    const result = extractPostText(makePost());
    expect(result.ownText).toBe('Hello world');
    expect(result.quotedText).toBeNull();
    expect(result.quotedUri).toBeNull();
    expect(result.quotedAltText).toBeNull();
    expect(result.searchText).toBe('Hello world');
  });

  it('extracts image alt text from record embed', () => {
    const post = makePost({
      record: {
        text: 'Check this out',
        createdAt: '2024-01-01T00:00:00Z',
        embed: {
          images: [{ alt: 'Movie poster for Jaws' }, { alt: '' }],
        },
      },
    });
    const result = extractPostText(post);
    expect(result.ownText).toBe('Check this out\n[image alt: Movie poster for Jaws]');
  });

  it('extracts image alt text from view embed', () => {
    const post = makePost({
      embed: {
        images: [{ alt: 'Scene from The Matrix' }],
      },
    });
    const result = extractPostText(post);
    expect(result.ownText).toContain('[image alt: Scene from The Matrix]');
  });

  it('deduplicates alt text across record and view embeds', () => {
    const post = makePost({
      record: {
        text: 'pic',
        createdAt: '2024-01-01T00:00:00Z',
        embed: { images: [{ alt: 'Same alt' }] },
      },
      embed: { images: [{ alt: 'Same alt' }] },
    });
    const result = extractPostText(post);
    // Should only appear once
    const altCount = (result.ownText.match(/\[image alt:/g) || []).length;
    expect(altCount).toBe(1);
  });

  it('extracts media.images alt text (recordWithMedia pattern)', () => {
    const post = makePost({
      record: {
        text: 'with media',
        createdAt: '2024-01-01T00:00:00Z',
        embed: { media: { images: [{ alt: 'Nested media alt' }] } },
      },
    });
    const result = extractPostText(post);
    expect(result.ownText).toContain('[image alt: Nested media alt]');
  });

  it('extracts quoted post text from record#view', () => {
    const post = makePost({
      embed: {
        $type: 'app.bsky.embed.record#view',
        record: {
          uri: 'at://did:plc:other/app.bsky.feed.post/xyz',
          value: { text: 'The original quote text' },
        },
      },
    });
    const result = extractPostText(post);
    expect(result.quotedText).toBe('The original quote text');
    expect(result.quotedUri).toBe('at://did:plc:other/app.bsky.feed.post/xyz');
    expect(result.searchText).toContain('The original quote text');
  });

  it('extracts quoted post text from recordWithMedia#view', () => {
    const post = makePost({
      embed: {
        $type: 'app.bsky.embed.recordWithMedia#view',
        record: {
          record: {
            uri: 'at://did:plc:other/app.bsky.feed.post/xyz',
            value: { text: 'Quote with media' },
          },
        },
        media: {
          images: [{ alt: 'Attached image' }],
        },
      },
    });
    const result = extractPostText(post);
    expect(result.quotedText).toBe('Quote with media');
    expect(result.quotedUri).toBe('at://did:plc:other/app.bsky.feed.post/xyz');
    expect(result.quotedAltText).toEqual(['Attached image']);
  });

  it('extracts quoted post alt text from record embeds', () => {
    const post = makePost({
      embed: {
        $type: 'app.bsky.embed.record#view',
        record: {
          uri: 'at://did:plc:other/app.bsky.feed.post/xyz',
          value: { text: 'Has images' },
          embeds: [{ images: [{ alt: 'Quoted image alt' }] }],
        },
      },
    });
    const result = extractPostText(post);
    expect(result.quotedAltText).toEqual(['Quoted image alt']);
    expect(result.searchText).toContain('Quoted image alt');
  });

  it('returns null for missing embed', () => {
    const post = makePost({ embed: undefined });
    const result = extractPostText(post);
    expect(result.quotedText).toBeNull();
    expect(result.quotedUri).toBeNull();
    expect(result.quotedAltText).toBeNull();
  });

  it('returns null for unknown embed type', () => {
    const post = makePost({
      embed: { $type: 'app.bsky.embed.external#view', external: {} },
    });
    const result = extractPostText(post);
    expect(result.quotedText).toBeNull();
    expect(result.quotedUri).toBeNull();
  });

  it('handles empty post text', () => {
    const post = makePost({
      record: { text: '', createdAt: '2024-01-01T00:00:00Z' },
    });
    const result = extractPostText(post);
    expect(result.ownText).toBe('');
    expect(result.searchText).toBe('');
  });

  it('combines all text sources in searchText', () => {
    const post = makePost({
      record: {
        text: 'Main text',
        createdAt: '2024-01-01T00:00:00Z',
        embed: { images: [{ alt: 'Own alt' }] },
      },
      embed: {
        $type: 'app.bsky.embed.recordWithMedia#view',
        record: {
          record: {
            uri: 'at://did:plc:other/app.bsky.feed.post/xyz',
            value: { text: 'Quoted text' },
          },
        },
        media: { images: [{ alt: 'Media alt' }] },
      },
    });
    const result = extractPostText(post);
    expect(result.searchText).toContain('Main text');
    expect(result.searchText).toContain('[image alt: Own alt]');
    expect(result.searchText).toContain('Quoted text');
    expect(result.searchText).toContain('Media alt');
  });

  it('extracts alt text from recordWithMedia embed with multiple images', () => {
    const post = makePost({
      embed: {
        $type: 'app.bsky.embed.recordWithMedia#view',
        record: {
          record: {
            uri: 'at://did:plc:other/app.bsky.feed.post/xyz',
            value: { text: 'Quote with images' },
          },
        },
        media: {
          images: [{ alt: 'First image alt' }, { alt: 'Second image alt' }, { alt: '' }],
        },
      },
    });
    const result = extractPostText(post);
    expect(result.quotedAltText).toEqual(['First image alt', 'Second image alt']);
  });

  it('returns null for recordWithMedia without media.images', () => {
    const post = makePost({
      embed: {
        $type: 'app.bsky.embed.recordWithMedia#view',
        record: {
          record: {
            uri: 'at://did:plc:other/app.bsky.feed.post/xyz',
            value: { text: 'Quote with media but no images' },
          },
        },
        media: {},
      },
    });
    const result = extractPostText(post);
    expect(result.quotedAltText).toBeNull();
  });

  it('returns null for recordWithMedia with empty alt text', () => {
    const post = makePost({
      embed: {
        $type: 'app.bsky.embed.recordWithMedia#view',
        record: {
          record: {
            uri: 'at://did:plc:other/app.bsky.feed.post/xyz',
            value: { text: 'Quote with images without alt' },
          },
        },
        media: {
          images: [{ alt: '' }, { alt: '' }],
        },
      },
    });
    const result = extractPostText(post);
    expect(result.quotedAltText).toBeNull();
  });

  it('extracts alt text from record#view inner embeds', () => {
    const post = makePost({
      embed: {
        $type: 'app.bsky.embed.record#view',
        record: {
          uri: 'at://did:plc:other/app.bsky.feed.post/xyz',
          value: { text: 'Quote with embedded images' },
          embeds: [
            { images: [{ alt: 'Embedded image 1' }] },
            { images: [{ alt: 'Embedded image 2' }, { alt: '' }] },
          ],
        },
      },
    });
    const result = extractPostText(post);
    expect(result.quotedAltText).toEqual(['Embedded image 1', 'Embedded image 2']);
  });

  it('returns null for record#view without inner embeds', () => {
    const post = makePost({
      embed: {
        $type: 'app.bsky.embed.record#view',
        record: {
          uri: 'at://did:plc:other/app.bsky.feed.post/xyz',
          value: { text: 'Quote without embeds' },
        },
      },
    });
    const result = extractPostText(post);
    expect(result.quotedAltText).toBeNull();
  });

  it('returns null for record#view with empty inner embeds', () => {
    const post = makePost({
      embed: {
        $type: 'app.bsky.embed.record#view',
        record: {
          uri: 'at://did:plc:other/app.bsky.feed.post/xyz',
          value: { text: 'Quote with empty embeds' },
          embeds: [],
        },
      },
    });
    const result = extractPostText(post);
    expect(result.quotedAltText).toBeNull();
  });

  it('handles embed without $type field', () => {
    const post = makePost({
      embed: {
        someField: 'value',
      },
    });
    const result = extractPostText(post);
    expect(result.quotedText).toBeNull();
    expect(result.quotedUri).toBeNull();
    expect(result.quotedAltText).toBeNull();
  });

  it('handles null embed gracefully', () => {
    const post = makePost({
      embed: null,
    });
    const result = extractPostText(post);
    expect(result.quotedText).toBeNull();
    expect(result.quotedUri).toBeNull();
    expect(result.quotedAltText).toBeNull();
    expect(result.embedLinks).toEqual([]);
  });

  it('handles recordWithMedia without record field', () => {
    const post = makePost({
      embed: {
        $type: 'app.bsky.embed.recordWithMedia#view',
        media: {
          images: [{ alt: 'Image without record' }],
        },
      },
    });
    const result = extractPostText(post);
    expect(result.quotedText).toBeNull();
    expect(result.quotedUri).toBeNull();
    expect(result.quotedAltText).toEqual(['Image without record']);
  });

  it('handles record#view without value field', () => {
    const post = makePost({
      embed: {
        $type: 'app.bsky.embed.record#view',
        record: {
          uri: 'at://did:plc:other/app.bsky.feed.post/xyz',
        },
      },
    });
    const result = extractPostText(post);
    expect(result.quotedText).toBeNull();
    expect(result.quotedUri).toBe('at://did:plc:other/app.bsky.feed.post/xyz');
  });

  it('includes embedLinks in PostTextContent', () => {
    const post = makePost({
      embed: {
        $type: 'app.bsky.embed.external#view',
        external: {
          uri: 'https://www.youtube.com/watch?v=abc123',
          title: 'Never Gonna Give You Up',
          description: 'Rick Astley',
        },
      },
    });
    const result = extractPostText(post);
    expect(result.embedLinks).toHaveLength(1);
    expect(result.embedLinks[0]!.platform).toBe('youtube');
    expect(result.embedLinks[0]!.title).toBe('Never Gonna Give You Up');
  });
});

describe('extractEmbedLinks', () => {
  it('extracts YouTube link from external embed', () => {
    const post = makePost({
      embed: {
        $type: 'app.bsky.embed.external#view',
        external: {
          uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          title: 'Rick Astley - Never Gonna Give You Up (Official Video)',
          description: 'The official video',
        },
      },
    });
    const links = extractEmbedLinks(post);
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up (Official Video)',
      platform: 'youtube',
    });
  });

  it('extracts Spotify link', () => {
    const post = makePost({
      embed: {
        external: {
          uri: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
          title: 'Celebration - Kool & The Gang',
        },
      },
    });
    const links = extractEmbedLinks(post);
    expect(links).toHaveLength(1);
    expect(links[0]!.platform).toBe('spotify');
  });

  it('detects Apple Music', () => {
    const post = makePost({
      embed: {
        external: {
          uri: 'https://music.apple.com/us/album/thriller/269572838',
          title: 'Thriller by Michael Jackson',
        },
      },
    });
    const links = extractEmbedLinks(post);
    expect(links[0]!.platform).toBe('apple');
  });

  it('detects SoundCloud', () => {
    const post = makePost({
      embed: {
        external: {
          uri: 'https://soundcloud.com/artist/track',
          title: 'Some Track',
        },
      },
    });
    const links = extractEmbedLinks(post);
    expect(links[0]!.platform).toBe('soundcloud');
  });

  it('detects Bandcamp', () => {
    const post = makePost({
      embed: {
        external: {
          uri: 'https://artist.bandcamp.com/track/some-song',
          title: 'Some Song',
        },
      },
    });
    const links = extractEmbedLinks(post);
    expect(links[0]!.platform).toBe('bandcamp');
  });

  it('detects youtu.be short URLs', () => {
    const post = makePost({
      embed: {
        external: {
          uri: 'https://youtu.be/dQw4w9WgXcQ',
          title: 'Rick Roll',
        },
      },
    });
    const links = extractEmbedLinks(post);
    expect(links[0]!.platform).toBe('youtube');
  });

  it('returns unknown for non-music URLs', () => {
    const post = makePost({
      embed: {
        external: {
          uri: 'https://example.com/page',
          title: 'Some Page',
        },
      },
    });
    const links = extractEmbedLinks(post);
    expect(links[0]!.platform).toBe('unknown');
  });

  it('extracts from recordWithMedia embed', () => {
    const post = makePost({
      embed: {
        $type: 'app.bsky.embed.recordWithMedia#view',
        record: {
          record: {
            uri: 'at://did:plc:other/app.bsky.feed.post/xyz',
            value: { text: 'Check this out' },
          },
        },
        media: {
          external: {
            uri: 'https://www.youtube.com/watch?v=test',
            title: 'Test Video',
          },
        },
      },
    });
    const links = extractEmbedLinks(post);
    expect(links).toHaveLength(1);
    expect(links[0]!.platform).toBe('youtube');
    expect(links[0]!.title).toBe('Test Video');
  });

  it('returns empty array when no embed', () => {
    const post = makePost({ embed: undefined });
    expect(extractEmbedLinks(post)).toEqual([]);
  });

  it('returns empty array when embed has no external data', () => {
    const post = makePost({
      embed: {
        $type: 'app.bsky.embed.images#view',
        images: [{ alt: 'photo' }],
      },
    });
    expect(extractEmbedLinks(post)).toEqual([]);
  });

  it('skips links with empty title', () => {
    const post = makePost({
      embed: {
        external: {
          uri: 'https://www.youtube.com/watch?v=abc',
          title: '',
        },
      },
    });
    expect(extractEmbedLinks(post)).toEqual([]);
  });

  it('skips links with whitespace-only title', () => {
    const post = makePost({
      embed: {
        external: {
          uri: 'https://www.youtube.com/watch?v=abc',
          title: '   ',
        },
      },
    });
    expect(extractEmbedLinks(post)).toEqual([]);
  });

  it('skips links with missing uri', () => {
    const post = makePost({
      embed: {
        external: {
          title: 'Some Title',
        },
      },
    });
    expect(extractEmbedLinks(post)).toEqual([]);
  });
});
