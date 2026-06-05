import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveEmbedTitles } from './oembed-client';

describe('resolveEmbedTitles', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty map for empty URL list', async () => {
    const result = await resolveEmbedTitles([]);
    expect(result.size).toBe(0);
  });

  it('resolves YouTube URLs via API', async () => {
    const mockResponse = {
      results: {
        'https://www.youtube.com/watch?v=abc': {
          title: 'Test Song - Test Artist',
          platform: 'youtube',
        },
      },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })
    );

    const result = await resolveEmbedTitles(['https://www.youtube.com/watch?v=abc']);
    expect(result.size).toBe(1);
    expect(result.get('https://www.youtube.com/watch?v=abc')).toEqual({
      url: 'https://www.youtube.com/watch?v=abc',
      title: 'Test Song - Test Artist',
      platform: 'youtube',
    });
  });

  it('reports progress', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: {} }),
      })
    );

    const progress: Array<{ total: number; resolved: number }> = [];
    await resolveEmbedTitles(['https://youtube.com/watch?v=1', 'https://youtube.com/watch?v=2'], {
      onProgress: (p) => progress.push({ ...p }),
    });

    expect(progress.length).toBeGreaterThanOrEqual(2);
    expect(progress[0]!.total).toBe(2);
    expect(progress[0]!.resolved).toBe(0);
  });

  it('batches URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const urls = Array.from({ length: 30 }, (_, i) => `https://youtube.com/watch?v=${i}`);
    await resolveEmbedTitles(urls, { batchSize: 10 });

    // Should make 3 batch requests
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('continues on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    // Should not throw
    const result = await resolveEmbedTitles(['https://youtube.com/watch?v=abc']);
    expect(result.size).toBe(0);
  });

  it('continues on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      })
    );

    const result = await resolveEmbedTitles(['https://youtube.com/watch?v=abc']);
    expect(result.size).toBe(0);
  });
});
