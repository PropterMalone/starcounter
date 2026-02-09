import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ValidationClient } from './validation-client';
import type { ValidationProgress } from './validation-client';
import type { MediaMention } from './mention-extractor';
import { MediaType } from './mention-extractor';

describe('ValidationClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should validate mentions with progress reporting', async () => {
    const mentions: MediaMention[] = [
      {
        title: 'The Matrix',
        normalizedTitle: 'matrix',
        mediaType: MediaType.MOVIE,
        confidence: 'high',
      },
      {
        title: 'Inception',
        normalizedTitle: 'inception',
        mediaType: MediaType.MOVIE,
        confidence: 'high',
      },
    ];

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ validated: true, confidence: 'high', title: 'The Matrix' }),
    });

    const progressUpdates: ValidationProgress[] = [];
    const client = new ValidationClient({
      apiUrl: 'http://test.com/api/validate',
      onProgress: (progress) => progressUpdates.push(progress),
    });

    const result = await client.validateMentions(mentions);

    expect(result).toHaveLength(2);
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[progressUpdates.length - 1].completed).toBe(2);
  });

  it('should batch requests', async () => {
    const mentions: Array<MediaMention> = Array(25)
      .fill(null)
      .map((_, i) => ({
        title: `Title ${i}`,
        normalizedTitle: `title${i}`,
        mediaType: MediaType.MOVIE,
        confidence: 'high',
      }));

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ validated: true, confidence: 'high' }),
    });

    const client = new ValidationClient({
      apiUrl: 'http://test.com/api/validate',
      batchSize: 10,
      batchDelayMs: 10,
    });

    await client.validateMentions(mentions);

    // Should make 25 fetch calls (not batched at API level, but delayed)
    expect(fetchMock.mock.calls.length).toBe(25);
  });

  it('should handle validation errors gracefully', async () => {
    const mentions: MediaMention[] = [
      {
        title: 'Unknown',
        normalizedTitle: 'unknown',
        mediaType: MediaType.MOVIE,
        confidence: 'high',
      },
    ];

    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const client = new ValidationClient({
      apiUrl: 'http://test.com/api/validate',
    });

    const result = await client.validateMentions(mentions);

    // Should return original mention on error
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Unknown');
  });

  it('should merge validation results with original mentions', async () => {
    const mentions: MediaMention[] = [
      {
        title: 'Breaking Bad',
        normalizedTitle: 'breaking bad',
        mediaType: MediaType.TV_SHOW,
        confidence: 'high',
      },
    ];

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        validated: true,
        confidence: 'high',
        title: 'Breaking Bad',
        source: 'tmdb',
      }),
    });

    const client = new ValidationClient({
      apiUrl: 'http://test.com/api/validate',
    });

    const result = await client.validateMentions(mentions);

    expect(result[0]).toMatchObject({
      title: 'Breaking Bad',
      validated: true,
      validationConfidence: 'high',
      validatedTitle: 'Breaking Bad',
    });
  });

  it('should handle network errors gracefully', async () => {
    const mentions: MediaMention[] = [
      {
        title: 'Some Movie',
        normalizedTitle: 'some movie',
        mediaType: MediaType.MOVIE,
        confidence: 'high',
      },
    ];

    fetchMock.mockRejectedValue(new Error('Network error'));

    const client = new ValidationClient({
      apiUrl: 'http://test.com/api/validate',
    });

    const result = await client.validateMentions(mentions);

    // Should return original mention on network error
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Some Movie');
  });

  it('should report progress for each batch', async () => {
    const mentions: MediaMention[] = [
      {
        title: 'Movie1',
        normalizedTitle: 'movie1',
        mediaType: MediaType.MOVIE,
        confidence: 'high',
      },
      {
        title: 'Movie2',
        normalizedTitle: 'movie2',
        mediaType: MediaType.MOVIE,
        confidence: 'high',
      },
      {
        title: 'Movie3',
        normalizedTitle: 'movie3',
        mediaType: MediaType.MOVIE,
        confidence: 'high',
      },
    ];

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ validated: true, confidence: 'high' }),
    });

    const progressUpdates: ValidationProgress[] = [];
    const client = new ValidationClient({
      apiUrl: 'http://test.com/api/validate',
      batchSize: 2,
      batchDelayMs: 5,
      onProgress: (progress) => progressUpdates.push(progress),
    });

    await client.validateMentions(mentions);

    // Should have progress updates for each batch
    expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
    expect(progressUpdates[progressUpdates.length - 1].total).toBe(3);
    expect(progressUpdates[progressUpdates.length - 1].completed).toBe(3);
  });

  it('should preserve artist information when present', async () => {
    const mentions: MediaMention[] = [
      {
        title: 'Bohemian Rhapsody',
        normalizedTitle: 'bohemian rhapsody',
        mediaType: MediaType.MUSIC,
        confidence: 'high',
        artist: 'Queen',
      },
    ];

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        validated: true,
        confidence: 'high',
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
      }),
    });

    const client = new ValidationClient({
      apiUrl: 'http://test.com/api/validate',
    });

    const result = await client.validateMentions(mentions);

    expect(result[0].artist).toBe('Queen');
  });

  it('should handle empty mentions array', async () => {
    const mentions: MediaMention[] = [];

    const progressUpdates: ValidationProgress[] = [];
    const client = new ValidationClient({
      apiUrl: 'http://test.com/api/validate',
      onProgress: (progress) => progressUpdates.push(progress),
    });

    const result = await client.validateMentions(mentions);

    expect(result).toHaveLength(0);
    expect(progressUpdates).toHaveLength(0);
  });

  it('should use fallback empty string when last batch item has undefined title', async () => {
    // Force a mention with undefined title to test the ?? '' fallback
    const mentionWithoutTitle = {
      normalizedTitle: 'movie1',
      mediaType: MediaType.MOVIE,
      confidence: 'high',
    } as MediaMention;

    const mentions: MediaMention[] = [mentionWithoutTitle];

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ validated: true, confidence: 'high', title: 'Movie' }),
    });

    const progressUpdates: ValidationProgress[] = [];
    const client = new ValidationClient({
      apiUrl: 'http://test.com/api/validate',
      onProgress: (progress) => progressUpdates.push(progress),
    });

    await client.validateMentions(mentions);

    // Should use empty string fallback when title is undefined
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[0].currentTitle).toBe('');
  });
});
