// pattern: Imperative Shell
// Cloudflare Pages Function for D1-backed shared results

type CloudflareEnv = {
  readonly SHARED_RESULTS: D1Database;
};

type PagesContext = {
  request: Request;
  env: CloudflareEnv;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 8;

// 10MB limit prevents abuse
const MAX_BODY_SIZE = 10 * 1024 * 1024;

function generateId(): string {
  const bytes = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) {
    id += ID_CHARS[byte % 62];
  }
  return id;
}

/**
 * CORS preflight handler.
 */
export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: corsHeaders });
}

/**
 * GET /api/share?id=xxx — retrieve shared results by ID.
 */
export async function onRequestGet(context: PagesContext): Promise<Response> {
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

  if (!id || id.length !== ID_LENGTH) {
    return new Response(JSON.stringify({ error: 'invalid id' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const row = await context.env.SHARED_RESULTS.prepare(
      'SELECT data FROM shared_results WHERE id = ?'
    )
      .bind(id)
      .first<{ data: string }>();

    if (!row) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(row.data, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * POST /api/share — store shared results, return {id}.
 */
export async function onRequestPost(context: PagesContext): Promise<Response> {
  try {
    const contentLength = context.request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      return new Response(JSON.stringify({ error: 'payload too large' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await context.request.text();

    // Validate it's valid JSON
    JSON.parse(body);

    const id = generateId();

    await context.env.SHARED_RESULTS.prepare(
      'INSERT INTO shared_results (id, data, created_at) VALUES (?, ?, ?)'
    )
      .bind(id, body, Date.now())
      .run();

    return new Response(JSON.stringify({ id }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}
