// pattern: Imperative Shell
// Cloudflare Pages Function: batch-resolve YouTube video titles via oEmbed API.
//
// YouTube's public oEmbed endpoint returns video metadata without requiring
// API keys. We batch requests server-side to avoid CORS issues and cache
// results in KV for 24 hours (titles rarely change).

type CloudflareEnv = {
  readonly VALIDATION_CACHE?: KVNamespace;
};

type PagesContext = {
  request: Request;
  env: CloudflareEnv;
};

type OEmbedResult = {
  readonly title: string;
  readonly platform: string;
};

type OEmbedResponse = {
  readonly results: Record<string, OEmbedResult>;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const CACHE_TTL = 60 * 60 * 24; // 24 hours
const CACHE_PREFIX = 'oembed:v1:';
const MAX_URLS = 50; // prevent abuse

/**
 * Resolve a single YouTube URL via the public oEmbed endpoint.
 * Returns the video title or null on failure.
 */
async function resolveYouTubeTitle(url: string): Promise<string | null> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(oembedUrl, {
      headers: { 'User-Agent': 'Starcounter/1.0 (https://starcounter.pages.dev)' },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { title?: string };
    return data.title?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Safely read from KV cache.
 */
async function cacheGet(cache: KVNamespace, url: string): Promise<string | null> {
  try {
    return await cache.get(`${CACHE_PREFIX}${url}`);
  } catch {
    return null;
  }
}

/**
 * Safely write to KV cache.
 */
async function cachePut(cache: KVNamespace, url: string, title: string): Promise<void> {
  try {
    await cache.put(`${CACHE_PREFIX}${url}`, title, { expirationTtl: CACHE_TTL });
  } catch {
    // KV write failed (quota) — continue without caching
  }
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: corsHeaders });
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request, env } = context;

  try {
    const body = (await request.json()) as { urls?: string[] };
    const urls = body.urls;

    if (!Array.isArray(urls) || urls.length === 0) {
      return new Response(JSON.stringify({ error: 'missing urls array' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Limit batch size
    const batch = urls.slice(0, MAX_URLS);
    const results: Record<string, OEmbedResult> = {};

    // Check cache first for all URLs
    const uncached: string[] = [];
    if (env.VALIDATION_CACHE) {
      const cacheChecks = await Promise.all(
        batch.map(async (url) => {
          const cached = await cacheGet(env.VALIDATION_CACHE!, url);
          if (cached) {
            results[url] = { title: cached, platform: 'youtube' };
            return true;
          }
          return false;
        })
      );
      for (let i = 0; i < batch.length; i++) {
        if (!cacheChecks[i]) uncached.push(batch[i]!);
      }
    } else {
      uncached.push(...batch);
    }

    // Resolve uncached URLs in parallel (limited concurrency via Promise.all)
    if (uncached.length > 0) {
      const resolved = await Promise.all(
        uncached.map(async (url) => {
          const title = await resolveYouTubeTitle(url);
          return { url, title };
        })
      );

      for (const { url, title } of resolved) {
        if (title) {
          results[url] = { title, platform: 'youtube' };
          if (env.VALIDATION_CACHE) {
            // Fire and forget — don't block response on cache writes
            cachePut(env.VALIDATION_CACHE, url, title);
          }
        }
      }
    }

    const response: OEmbedResponse = { results };
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}

export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    if (request.method === 'OPTIONS') return onRequestOptions();
    if (request.method === 'POST') return onRequestPost({ request, env });
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  },
};
