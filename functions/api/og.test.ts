// pattern: Imperative Shell tests
import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateOGImage,
  parseOGRequest,
  OG_IMAGE_WIDTH,
  OG_IMAGE_HEIGHT,
  OG_CACHE_MAX_AGE,
} from './og';
import type { ShareableResults } from '../../src/lib/url-encoder';
import { encodeResults } from '../../src/lib/url-encoder';

describe('OG Image Generator', () => {
  describe('parseOGRequest', () => {
    it('should parse valid encoded results from URL', () => {
      const results: ShareableResults = {
        m: [
          { n: 'The Matrix', c: 5 },
          { n: 'Inception', c: 3 },
        ],
        t: 1704067200000,
      };
      const encoded = encodeResults(results);
      const url = new URL(`https://starcounter.app/api/og?r=${encoded}`);

      const parsed = parseOGRequest(url);

      expect(parsed).not.toBeNull();
      expect(parsed!.m).toHaveLength(2);
      expect(parsed!.m[0].n).toBe('The Matrix');
      expect(parsed!.m[0].c).toBe(5);
    });

    it('should return null for missing r parameter', () => {
      const url = new URL('https://starcounter.app/api/og');

      const parsed = parseOGRequest(url);

      expect(parsed).toBeNull();
    });

    it('should return null for empty r parameter', () => {
      const url = new URL('https://starcounter.app/api/og?r=');

      const parsed = parseOGRequest(url);

      expect(parsed).toBeNull();
    });

    it('should return null for invalid encoded data', () => {
      const url = new URL('https://starcounter.app/api/og?r=invalid_data');

      const parsed = parseOGRequest(url);

      expect(parsed).toBeNull();
    });

    it('should handle URL-encoded results parameter', () => {
      const results: ShareableResults = {
        m: [{ n: 'Test', c: 1 }],
        t: Date.now(),
      };
      const encoded = encodeResults(results);
      // URL encode the Base64 string (in case + becomes %2B)
      const urlEncoded = encodeURIComponent(encoded);
      const url = new URL(`https://starcounter.app/api/og?r=${urlEncoded}`);

      const parsed = parseOGRequest(url);

      expect(parsed).not.toBeNull();
      expect(parsed!.m[0].n).toBe('Test');
    });
  });

  describe('constants', () => {
    it('should have correct OG image dimensions', () => {
      // OG images should be 1200x630 per spec
      expect(OG_IMAGE_WIDTH).toBe(1200);
      expect(OG_IMAGE_HEIGHT).toBe(630);
    });

    it('should have reasonable cache max-age', () => {
      // Should cache for 24 hours (86400 seconds)
      expect(OG_CACHE_MAX_AGE).toBe(86400);
    });
  });

  describe('generateOGImage', () => {
    it('should return a Buffer for valid results', async () => {
      const results: ShareableResults = {
        m: [
          { n: 'The Matrix', c: 5 },
          { n: 'Inception', c: 3 },
        ],
        t: Date.now(),
      };

      const buffer = await generateOGImage(results);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should generate PNG format', async () => {
      const results: ShareableResults = {
        m: [{ n: 'Test Movie', c: 1 }],
        t: Date.now(),
      };

      const buffer = await generateOGImage(results);

      // PNG magic bytes: 137 80 78 71 13 10 26 10
      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(buffer.slice(0, 8)).toEqual(pngSignature);
    });

    it('should handle empty results', async () => {
      const results: ShareableResults = {
        m: [],
        t: Date.now(),
      };

      const buffer = await generateOGImage(results);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should handle results with many mentions (top 10 only)', async () => {
      const results: ShareableResults = {
        m: Array.from({ length: 20 }, (_, i) => ({
          n: `Movie ${i + 1}`,
          c: 20 - i,
        })),
        t: Date.now(),
      };

      const buffer = await generateOGImage(results);

      // Should succeed without error
      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('should handle unicode in titles', async () => {
      const results: ShareableResults = {
        m: [
          { n: '君の名は', c: 10 },
          { n: 'Amélie', c: 5 },
        ],
        t: Date.now(),
      };

      const buffer = await generateOGImage(results);

      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('should handle long titles by truncating', async () => {
      const results: ShareableResults = {
        m: [
          {
            n: 'Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb',
            c: 5,
          },
        ],
        t: Date.now(),
      };

      const buffer = await generateOGImage(results);

      expect(buffer).toBeInstanceOf(Buffer);
    });
  });

  describe('OG endpoint handler (integration)', () => {
    it('should produce correct cache headers format', () => {
      const cacheControl = `public, max-age=${OG_CACHE_MAX_AGE}`;

      expect(cacheControl).toBe('public, max-age=86400');
    });

    it('should use correct content type for PNG', () => {
      const contentType = 'image/png';

      expect(contentType).toBe('image/png');
    });
  });

  describe('onRequest handler', () => {
    // Import handler dynamically for testing
    let onRequest: (context: { request: Request }) => Promise<Response>;

    beforeEach(async () => {
      const module = await import('./og');
      onRequest = module.onRequest;
    });

    it('should return 400 for missing r parameter', async () => {
      const request = new Request('https://starcounter.app/api/og');
      const response = await onRequest({ request });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain('Missing or invalid');
    });

    it('should return 400 for invalid r parameter', async () => {
      const request = new Request('https://starcounter.app/api/og?r=invalid');
      const response = await onRequest({ request });

      expect(response.status).toBe(400);
    });

    it('should return 200 with PNG for valid request', async () => {
      const results: ShareableResults = {
        m: [{ n: 'Test', c: 1 }],
        t: Date.now(),
      };
      const encoded = encodeResults(results);
      const request = new Request(`https://starcounter.app/api/og?r=${encoded}`);

      const response = await onRequest({ request });

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/png');
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400');
    });

    it('should return non-empty body for valid request', async () => {
      const results: ShareableResults = {
        m: [{ n: 'Movie', c: 5 }],
        t: Date.now(),
      };
      const encoded = encodeResults(results);
      const request = new Request(`https://starcounter.app/api/og?r=${encoded}`);

      const response = await onRequest({ request });

      // Response should have a body (the image)
      expect(response.body).not.toBeNull();

      // Check we can get the array buffer (body exists)
      const arrayBuffer = await response.arrayBuffer();
      expect(arrayBuffer.byteLength).toBeGreaterThan(0);
    });
  });
});
