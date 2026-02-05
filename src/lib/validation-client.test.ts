import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ValidationClient } from './validation-client';
import type { MediaMention } from './mention-extractor';
import { MediaType } from './mention-extractor';

global.fetch = vi.fn();

describe('ValidationClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ validated: true, confidence: 'high', title: 'The Matrix' }),
    });

    const progressUpdates: any[] = [];
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
    const mentions: MediaMention[] = Array(25)
      .fill(null)
      .map((_, i) => ({
        title: `Title ${i}`,
        normalizedTitle: `title${i}`,
        mediaType: MediaType.MOVIE,
        confidence: 'high',
      }));

    (global.fetch as any).mockResolvedValue({
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
    expect((global.fetch as any).mock.calls.length).toBe(25);
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

    (global.fetch as any).mockResolvedValue({
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

    (global.fetch as any).mockResolvedValue({
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

    (global.fetch as any).mockRejectedValue(new Error('Network error'));

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

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ validated: true, confidence: 'high' }),
    });

    const progressUpdates: any[] = [];
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

    (global.fetch as any).mockResolvedValue({
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
});
