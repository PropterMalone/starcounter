// pattern: Imperative Shell
// Cloudflare Pages Function: batch-resolve YouTube video titles via oEmbed API.
//
// YouTube's public oEmbed endpoint returns video metadata without requiring
// API keys. We batch requests server-side to avoid CORS issues.

type PagesContext = {
  request: Request;
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

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: corsHeaders });
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request } = context;

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

    // Resolve all URLs in parallel
    const resolved = await Promise.all(
      batch.map(async (url) => {
        const title = await resolveYouTubeTitle(url);
        return { url, title };
      })
    );

    for (const { url, title } of resolved) {
      if (title) {
        results[url] = { title, platform: 'youtube' };
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
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return onRequestOptions();
    if (request.method === 'POST') return onRequestPost({ request });
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  },
};
