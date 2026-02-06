// pattern: Imperative Shell
import { Resvg } from '@cf-wasm/resvg';
import { decodeResults } from '../../src/lib/url-encoder';
import type { ShareableResults, ShareableMention } from '../../src/lib/url-encoder';

/**
 * OG image dimensions per Open Graph spec
 */
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/**
 * Cache duration for OG images (24 hours in seconds)
 */
export const OG_CACHE_MAX_AGE = 86400;

/**
 * Maximum number of mentions to display in chart
 */
const MAX_CHART_ITEMS = 10;

/**
 * Maximum title length before truncation
 */
const MAX_TITLE_LENGTH = 30;

/**
 * Rainbow colors matching the chart (repeating pattern)
 */
const BAR_COLORS = [
  '#ff6384', // Hot pink
  '#ff7f50', // Coral
  '#ff9f40', // Orange
  '#ffc107', // Amber
  '#cddc39', // Lime
  '#4caf50', // Green
  '#00bcd4', // Cyan
  '#2196f3', // Blue
  '#673ab7', // Deep purple
  '#9c27b0', // Purple
];

/**
 * Parse OG request URL and extract ShareableResults
 */
export function parseOGRequest(url: URL): ShareableResults | null {
  const encoded = url.searchParams.get('r');
  if (!encoded) {
    return null;
  }

  return decodeResults(encoded);
}

/**
 * Truncate title if too long
 */
function truncateTitle(title: string, maxLength: number = MAX_TITLE_LENGTH): string {
  if (title.length <= maxLength) {
    return title;
  }
  return title.slice(0, maxLength - 1) + '…';
}

/**
 * Escape special XML/HTML characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate SVG for the OG image
 */
function generateSVG(results: ShareableResults): string {
  const width = OG_IMAGE_WIDTH;
  const height = OG_IMAGE_HEIGHT;

  // Chart area dimensions
  const chartPadding = { top: 100, right: 50, bottom: 60, left: 200 };
  const chartWidth = width - chartPadding.left - chartPadding.right;
  const chartHeight = height - chartPadding.top - chartPadding.bottom;

  // Get top mentions (up to MAX_CHART_ITEMS)
  const topMentions = results.m.slice(0, MAX_CHART_ITEMS);
  const maxCount = Math.max(...topMentions.map((m) => m.c), 1);

  // Calculate bar dimensions
  const barCount = topMentions.length || 1;
  const barGap = 10;
  const barHeight = Math.min((chartHeight - barGap * (barCount - 1)) / barCount, 40);
  const actualChartHeight = barCount * barHeight + (barCount - 1) * barGap;
  const chartStartY = chartPadding.top + (chartHeight - actualChartHeight) / 2;

  // Generate bar elements with repeating rainbow colors
  const bars = topMentions
    .map((mention: ShareableMention, index: number) => {
      const barWidth = (mention.c / maxCount) * chartWidth;
      const y = chartStartY + index * (barHeight + barGap);
      const title = escapeXml(truncateTitle(mention.n));
      const barColor = BAR_COLORS[index % BAR_COLORS.length];

      return `
      <!-- Bar ${index + 1}: ${title} -->
      <rect x="${chartPadding.left}" y="${y}" width="${barWidth}" height="${barHeight}"
            fill="${barColor}" rx="4" ry="4"/>
      <text x="${chartPadding.left - 10}" y="${y + barHeight / 2 + 5}"
            text-anchor="end" fill="#e2e8f0" font-size="16" font-family="system-ui, sans-serif">
        ${title}
      </text>
      <text x="${chartPadding.left + barWidth + 10}" y="${y + barHeight / 2 + 5}"
            text-anchor="start" fill="#94a3b8" font-size="14" font-family="system-ui, sans-serif">
        ${mention.c}
      </text>
    `;
    })
    .join('');

  // Handle empty results
  const emptyMessage =
    topMentions.length === 0
      ? `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#94a3b8"
           font-size="20" font-family="system-ui, sans-serif">No mentions found</text>`
      : '';

  // Total count
  const totalCount = results.m.reduce((sum: number, m: ShareableMention) => sum + m.c, 0);
  const totalMentions = results.m.length;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
     xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="100%" height="100%" fill="#0f172a"/>

  <!-- Title -->
  <text x="50" y="55" fill="#f8fafc" font-size="32" font-weight="bold"
        font-family="system-ui, sans-serif">
    ⭐ Starcounter Analysis
  </text>

  <!-- Subtitle with stats -->
  <text x="50" y="80" fill="#94a3b8" font-size="16" font-family="system-ui, sans-serif">
    ${totalMentions} unique mentions • ${totalCount} total references
  </text>

  ${emptyMessage || bars}

  <!-- Footer -->
  <text x="${width - 50}" y="${height - 25}" text-anchor="end" fill="#64748b"
        font-size="14" font-family="system-ui, sans-serif">
    starcounter.app
  </text>
</svg>`;
}

/**
 * Generate OG image as PNG (returns Uint8Array for Workers compatibility)
 */
export async function generateOGImage(results: ShareableResults): Promise<Uint8Array> {
  const svg = generateSVG(results);

  const resvg = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: OG_IMAGE_WIDTH,
    },
  });

  const pngData = resvg.render();
  return pngData.asPng();
}

/**
 * Cloudflare Workers handler for OG image endpoint
 */
export async function onRequest(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url);
  const results = parseOGRequest(url);

  if (!results) {
    return new Response('Missing or invalid results parameter', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  try {
    const pngBuffer = await generateOGImage(results);

    return new Response(pngBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': `public, max-age=${OG_CACHE_MAX_AGE}`,
      },
    });
  } catch (error) {
    console.error('OG image generation failed:', error);
    return new Response('Failed to generate image', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

export default { fetch: onRequest };
