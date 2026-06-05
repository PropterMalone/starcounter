// pattern: Imperative Shell
// Client-side wrapper for the /api/oembed endpoint.
// Batches YouTube URLs, reports progress, returns resolved titles.

export type OEmbedResult = {
  readonly url: string;
  readonly title: string;
  readonly platform: string;
};

export type OEmbedProgress = {
  readonly total: number;
  readonly resolved: number;
};

export type OEmbedClientOptions = {
  readonly apiUrl?: string;
  readonly onProgress?: (progress: OEmbedProgress) => void;
  readonly batchSize?: number;
};

type OEmbedApiResponse = {
  readonly results: Record<string, { title: string; platform: string }>;
};

/**
 * Resolve YouTube video titles via the server-side oEmbed endpoint.
 *
 * @param urls Array of YouTube URLs to resolve
 * @param options Client configuration
 * @returns Map of URL → resolved title
 */
export async function resolveEmbedTitles(
  urls: string[],
  options: OEmbedClientOptions = {}
): Promise<Map<string, OEmbedResult>> {
  const apiUrl = options.apiUrl ?? '/api/oembed';
  const batchSize = options.batchSize ?? 25;
  const onProgress = options.onProgress ?? (() => {});
  const results = new Map<string, OEmbedResult>();

  if (urls.length === 0) return results;

  onProgress({ total: urls.length, resolved: 0 });

  // Process in batches
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: batch }),
      });

      if (response.ok) {
        const data = (await response.json()) as OEmbedApiResponse;
        for (const [url, result] of Object.entries(data.results)) {
          results.set(url, { url, title: result.title, platform: result.platform });
        }
      }
    } catch {
      // Network error — skip this batch, continue with remaining
    }

    onProgress({ total: urls.length, resolved: results.size });
  }

  return results;
}
