// pattern: Functional Core
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { encodeResults, decodeResults, toShareableResults, MAX_URL_LENGTH } from './url-encoder';
import type { MentionCount } from '../types';
import type { ShareableResults } from './url-encoder';

describe('url-encoder', () => {
  describe('toShareableResults', () => {
    it('should convert MentionCount[] to compact ShareableResults', () => {
      const mentionCounts: MentionCount[] = [
        {
          mention: 'The Matrix',
          count: 5,
          posts: [
            {
              uri: 'at://did:plc:123/app.bsky.feed.post/abc',
              cid: 'cid123',
              author: { did: 'did:plc:123', handle: 'user.bsky.social' },
              record: { text: 'I love The Matrix', createdAt: '2026-01-01T00:00:00Z' },
              indexedAt: '2026-01-01T00:00:00Z',
            },
          ],
        },
        {
          mention: 'Inception',
          count: 3,
          posts: [],
        },
      ];

      const shareable = toShareableResults(mentionCounts);

      expect(shareable.m).toEqual([
        { n: 'The Matrix', c: 5 },
        { n: 'Inception', c: 3 },
      ]);
      expect(shareable.t).toBeDefined();
      expect(typeof shareable.t).toBe('number');
    });

    it('should include timestamp', () => {
      const before = Date.now();
      const shareable = toShareableResults([]);
      const after = Date.now();

      expect(shareable.t).toBeGreaterThanOrEqual(before);
      expect(shareable.t).toBeLessThanOrEqual(after);
    });

    it('should handle empty mention counts', () => {
      const shareable = toShareableResults([]);

      expect(shareable.m).toEqual([]);
    });
  });

  describe('encodeResults / decodeResults round-trip', () => {
    it('should encode and decode simple results', () => {
      const results: ShareableResults = {
        m: [
          { n: 'The Matrix', c: 5 },
          { n: 'Inception', c: 3 },
        ],
        t: 1704067200000,
      };

      const encoded = encodeResults(results);
      const decoded = decodeResults(encoded);

      expect(decoded).toEqual(results);
    });

    it('should produce URL-safe encoded string', () => {
      const results: ShareableResults = {
        m: [{ n: 'Test Movie', c: 1 }],
        t: Date.now(),
      };

      const encoded = encodeResults(results);

      // URL-safe characters only (Base64 alphabet)
      expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('should handle unicode characters', () => {
      const results: ShareableResults = {
        m: [
          { n: 'Crouching Tiger, Hidden Dragon', c: 2 },
          { n: 'Amélie', c: 1 },
          { n: '君の名は', c: 4 },
        ],
        t: Date.now(),
      };

      const encoded = encodeResults(results);
      const decoded = decodeResults(encoded);

      expect(decoded).toEqual(results);
    });

    it('should handle special characters', () => {
      const results: ShareableResults = {
        m: [
          { n: 'Se7en', c: 1 },
          { n: "Ocean's Eleven", c: 2 },
          { n: 'Spider-Man: No Way Home', c: 3 },
        ],
        t: Date.now(),
      };

      const encoded = encodeResults(results);
      const decoded = decodeResults(encoded);

      expect(decoded).toEqual(results);
    });

    it('should handle large mention counts', () => {
      const results: ShareableResults = {
        m: Array.from({ length: 50 }, (_, i) => ({
          n: `Movie ${i + 1}`,
          c: Math.floor(Math.random() * 100),
        })),
        t: Date.now(),
      };

      const encoded = encodeResults(results);
      const decoded = decodeResults(encoded);

      expect(decoded).toEqual(results);
    });

    it('should handle empty results', () => {
      const results: ShareableResults = {
        m: [],
        t: Date.now(),
      };

      const encoded = encodeResults(results);
      const decoded = decodeResults(encoded);

      expect(decoded).toEqual(results);
    });
  });

  describe('decodeResults error handling', () => {
    it('should return null for empty string', () => {
      expect(decodeResults('')).toBeNull();
    });

    it('should return null for invalid Base64', () => {
      expect(decodeResults('not-valid-base64!!!')).toBeNull();
    });

    it('should return null for corrupted compressed data', () => {
      expect(decodeResults('SGVsbG8gV29ybGQ=')).toBeNull(); // "Hello World" in Base64
    });

    it('should return null for valid JSON but wrong structure', async () => {
      // Manually craft valid LZ-compressed wrong structure
      // This tests the validation layer
      const wrongStructure = { foo: 'bar' };
      const json = JSON.stringify(wrongStructure);

      const LZString = await import('lz-string');
      const compressed = LZString.compressToBase64(json);

      expect(decodeResults(compressed)).toBeNull();
    });

    it('should return null for missing required fields', async () => {
      const LZString = await import('lz-string');

      // Missing 't' field
      const missingT = { m: [{ n: 'Test', c: 1 }] };
      expect(decodeResults(LZString.compressToBase64(JSON.stringify(missingT)))).toBeNull();

      // Missing 'm' field
      const missingM = { t: Date.now() };
      expect(decodeResults(LZString.compressToBase64(JSON.stringify(missingM)))).toBeNull();
    });

    it('should return null for non-object values', async () => {
      const LZString = await import('lz-string');

      // Primitive value
      expect(decodeResults(LZString.compressToBase64(JSON.stringify('string')))).toBeNull();
      expect(decodeResults(LZString.compressToBase64(JSON.stringify(123)))).toBeNull();
      expect(decodeResults(LZString.compressToBase64(JSON.stringify(null)))).toBeNull();
    });

    it('should return null for invalid mention entries in array', async () => {
      const LZString = await import('lz-string');

      // Mention is null
      const nullMention = { m: [null], t: Date.now() };
      expect(decodeResults(LZString.compressToBase64(JSON.stringify(nullMention)))).toBeNull();

      // Mention is primitive
      const primitiveMention = { m: ['string'], t: Date.now() };
      expect(decodeResults(LZString.compressToBase64(JSON.stringify(primitiveMention)))).toBeNull();
    });

    it('should return null for mention with wrong field types', async () => {
      const LZString = await import('lz-string');

      // n is not a string
      const wrongN = { m: [{ n: 123, c: 1 }], t: Date.now() };
      expect(decodeResults(LZString.compressToBase64(JSON.stringify(wrongN)))).toBeNull();

      // c is not a number
      const wrongC = { m: [{ n: 'Test', c: 'one' }], t: Date.now() };
      expect(decodeResults(LZString.compressToBase64(JSON.stringify(wrongC)))).toBeNull();
    });
  });

  describe('URL length constraints', () => {
    it('should produce encoded output under MAX_URL_LENGTH for typical results', () => {
      // Typical analysis: 20 movies with reasonable names
      const results: ShareableResults = {
        m: [
          { n: 'The Matrix', c: 42 },
          { n: 'Inception', c: 38 },
          { n: 'The Dark Knight', c: 35 },
          { n: 'Pulp Fiction', c: 28 },
          { n: 'Fight Club', c: 25 },
          { n: 'Forrest Gump', c: 22 },
          { n: 'The Shawshank Redemption', c: 20 },
          { n: 'Interstellar', c: 18 },
          { n: 'The Godfather', c: 15 },
          { n: 'Goodfellas', c: 12 },
          { n: 'Parasite', c: 10 },
          { n: 'Whiplash', c: 8 },
          { n: 'Arrival', c: 7 },
          { n: 'Dune', c: 6 },
          { n: 'Her', c: 5 },
          { n: 'Drive', c: 4 },
          { n: 'Jaws', c: 3 },
          { n: 'Alien', c: 2 },
          { n: 'Heat', c: 1 },
          { n: 'Gladiator', c: 1 },
        ],
        t: Date.now(),
      };

      const encoded = encodeResults(results);

      expect(encoded.length).toBeLessThan(MAX_URL_LENGTH);
    });

    it('should have MAX_URL_LENGTH set to reasonable value', () => {
      // Query params should stay under 2000 chars for compatibility
      expect(MAX_URL_LENGTH).toBeLessThanOrEqual(2000);
      expect(MAX_URL_LENGTH).toBeGreaterThan(100);
    });
  });

  describe('property-based tests', () => {
    const shareableMentionArb = fc.record({
      n: fc.string({ minLength: 1, maxLength: 100 }),
      c: fc.integer({ min: 0, max: 10000 }),
    });

    const shareableResultsArb = fc.record({
      m: fc.array(shareableMentionArb, { minLength: 0, maxLength: 30 }),
      t: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    });

    it('round-trip preserves data', () => {
      fc.assert(
        fc.property(shareableResultsArb, (results) => {
          const encoded = encodeResults(results);
          const decoded = decodeResults(encoded);

          expect(decoded).toEqual(results);
        }),
        { numRuns: 100 }
      );
    });

    it('encoded output is always a string', () => {
      fc.assert(
        fc.property(shareableResultsArb, (results) => {
          const encoded = encodeResults(results);

          expect(typeof encoded).toBe('string');
          expect(encoded.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });

    it('decode never throws on arbitrary input', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          // Should return null for invalid input, never throw
          expect(() => decodeResults(input)).not.toThrow();
        }),
        { numRuns: 100 }
      );
    });
  });
});
