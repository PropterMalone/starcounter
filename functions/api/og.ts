// pattern: Imperative Shell
import { ImageResponse } from '@cf-wasm/og';
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
const _MAX_CHART_ITEMS = 10;

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
  const encodedRaw = url.searchParams.get('r');
  if (!encodedRaw) {
    return null;
  }

  // URL parser decodes + as space, but LZ-string uses + in its alphabet
  const encoded = encodedRaw.replace(/ /g, '+');
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
 * Generate OG image as PNG using Satori/ImageResponse
 */
export async function generateOGImage(results: ShareableResults): Promise<Response> {
  const topMentions = results.m.slice(0, 5); // Show top 5 for cleaner layout
  const maxCount = Math.max(...topMentions.map((m) => m.c), 1);
  const totalCount = results.m.reduce((sum: number, m: ShareableMention) => sum + m.c, 0);
  const totalMentions = results.m.length;

  // Build bar rows
  const barRows = topMentions.map((mention: ShareableMention, index: number) => ({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        alignItems: 'center',
        marginBottom: 16,
        height: 40,
      },
      children: [
        // Label
        {
          type: 'div',
          props: {
            style: {
              width: 280,
              fontSize: 16,
              color: '#e2e8f0',
              textAlign: 'right',
              paddingRight: 16,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
            children: truncateTitle(mention.n, 35),
          },
        },
        // Bar container
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flex: 1,
              height: 36,
              backgroundColor: '#1e293b',
              borderRadius: 6,
            },
            children: [
              // Filled bar
              {
                type: 'div',
                props: {
                  style: {
                    width: `${(mention.c / maxCount) * 100}%`,
                    height: '100%',
                    backgroundColor: BAR_COLORS[index % BAR_COLORS.length],
                    borderRadius: 6,
                  },
                },
              },
            ],
          },
        },
        // Count
        {
          type: 'div',
          props: {
            style: {
              width: 50,
              fontSize: 16,
              color: '#94a3b8',
              textAlign: 'left',
              paddingLeft: 12,
            },
            children: String(mention.c),
          },
        },
      ],
    },
  }));

  // Create simple element structure for Satori
  const element = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: '#0f172a',
        padding: 50,
      },
      children: [
        // Title
        {
          type: 'div',
          props: {
            style: {
              fontSize: 42,
              fontWeight: 700,
              color: '#f8fafc',
              marginBottom: 8,
            },
            children: 'Starcounter Analysis',
          },
        },
        // Subtitle
        {
          type: 'div',
          props: {
            style: {
              fontSize: 20,
              color: '#94a3b8',
              marginBottom: 40,
            },
            children: `${totalMentions} unique mentions · ${totalCount} total references`,
          },
        },
        // Chart area
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              justifyContent: 'center',
            },
            children:
              barRows.length > 0
                ? barRows
                : {
                    type: 'div',
                    props: {
                      style: {
                        fontSize: 24,
                        color: '#64748b',
                        textAlign: 'center',
                      },
                      children: 'No mentions found',
                    },
                  },
          },
        },
        // Footer
        {
          type: 'div',
          props: {
            style: {
              fontSize: 16,
              color: '#64748b',
              textAlign: 'right',
            },
            children: 'starcounter.pages.dev',
          },
        },
      ],
    },
  };

  return new ImageResponse(element, {
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
  });
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
    const response = await generateOGImage(results);

    // Get the image data and create new response with cache headers
    const imageData = await response.arrayBuffer();

    return new Response(imageData, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': `public, max-age=${OG_CACHE_MAX_AGE}`,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('OG image generation failed:', errorMessage, errorStack);
    return new Response(`Failed to generate image: ${errorMessage}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

export default { fetch: onRequest };
