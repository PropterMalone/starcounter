// pattern: Imperative Shell
// Cloudflare Pages middleware for dynamic Open Graph tags on shared results

import * as LZString from 'lz-string';

type ShareableMention = {
  readonly n: string; // name/title
  readonly c: number; // count
};

type ShareableResults = {
  readonly m: readonly ShareableMention[]; // mentions
  readonly t: number; // timestamp
};

type PagesContext = {
  request: Request;
  next: () => Promise<Response>;
  env: Record<string, unknown>;
};

/**
 * Decode compressed results from URL parameter.
 * Returns null if decoding fails.
 */
function decodeResults(encoded: string): ShareableResults | null {
  if (!encoded) {
    return null;
  }

  try {
    const decompressed = LZString.decompressFromEncodedURIComponent(encoded);
    if (!decompressed) {
      return null;
    }

    const parsed = JSON.parse(decompressed);

    // Validate structure
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    if (!Array.isArray(parsed.m)) {
      return null;
    }
    if (typeof parsed.t !== 'number') {
      return null;
    }

    return parsed as ShareableResults;
  } catch {
    return null;
  }
}

/**
 * Generate dynamic OG tags based on decoded results.
 */
function generateOGTags(
  results: ShareableResults,
  url: string,
  encoded: string,
  origin: string
): string {
  const mentions = results.m;
  const topMentions = mentions.slice(0, 5);

  // Build title
  const title =
    mentions.length > 0
      ? `Starcounter Results - Top ${Math.min(mentions.length, 5)} Mentions`
      : 'Starcounter Results';

  // Build description with top mentions
  const description =
    topMentions.length > 0
      ? topMentions.map((m, i) => `${i + 1}. ${m.n} (${m.c})`).join(', ')
      : 'Bluesky thread analysis results';

  // Dynamic OG image showing the top results chart (use same origin as request)
  // encodeURIComponent ensures + becomes %2B so it's preserved through URL parsing
  const imageUrl = `${origin}/api/og?r=${encodeURIComponent(encoded)}`;

  return `
    <!-- Dynamic Open Graph meta tags for shared results -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Starcounter" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:url" content="${escapeHtml(url)}" />

    <!-- Twitter Card meta tags (also used by Bluesky) -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${imageUrl}" />`;
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Replace static OG tags with dynamic ones in HTML.
 */
function injectDynamicOGTags(html: string, dynamicTags: string): string {
  // Remove existing OG and Twitter meta tags
  const ogTagPattern = /<meta\s+(?:property="og:|name="twitter:)[^>]*>\s*/gi;
  let cleanedHtml = html.replace(ogTagPattern, '');

  // Also remove the comment
  cleanedHtml = cleanedHtml.replace(/<!-- Open Graph meta tags for social sharing -->\s*/gi, '');
  cleanedHtml = cleanedHtml.replace(
    /<!-- Twitter Card meta tags \(also used by Bluesky\) -->\s*/gi,
    ''
  );

  // Insert dynamic tags after <title>
  const titleEndIndex = cleanedHtml.indexOf('</title>');
  if (titleEndIndex !== -1) {
    const insertPoint = titleEndIndex + '</title>'.length;
    return cleanedHtml.slice(0, insertPoint) + dynamicTags + cleanedHtml.slice(insertPoint);
  }

  return cleanedHtml;
}

/**
 * Cloudflare Pages middleware handler.
 * Intercepts requests to inject dynamic OG tags for shared results.
 */
export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, next } = context;
  const url = new URL(request.url);

  // Only process requests to the main page (not API, not assets)
  const isMainPage = url.pathname === '/' || url.pathname === '/index.html';
  const hasResultsParam = url.searchParams.has('r');

  // Pass through non-main-page requests
  if (!isMainPage) {
    return next();
  }

  // If no results param, just serve the page with static OG tags
  if (!hasResultsParam) {
    return next();
  }

  // Decode the results
  // Note: URL parser decodes + as space, but LZ-string uses + in its alphabet
  const encodedRaw = url.searchParams.get('r');
  if (!encodedRaw) {
    return next();
  }
  const encoded = encodedRaw.replace(/ /g, '+');

  const results = decodeResults(encoded);
  if (!results) {
    // Invalid results param - serve page normally
    return next();
  }

  // Fetch the original HTML
  const response = await next();

  // Only modify HTML responses
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return response;
  }

  // Get HTML and inject dynamic OG tags
  const html = await response.text();
  const dynamicTags = generateOGTags(results, url.toString(), encoded, url.origin);
  const modifiedHtml = injectDynamicOGTags(html, dynamicTags);

  // Return modified response
  return new Response(modifiedHtml, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
