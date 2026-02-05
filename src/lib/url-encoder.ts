// pattern: Functional Core
import LZString from 'lz-string';
import type { MentionCount } from '../types';

/**
 * Maximum URL length for encoded results.
 * Keeping under 2000 chars ensures compatibility with most browsers and services.
 */
export const MAX_URL_LENGTH = 1800;

/**
 * Compact representation of a mention for URL sharing.
 * Uses short field names to minimize encoded size.
 */
export type ShareableMention = {
  readonly n: string; // name/title
  readonly c: number; // count
};

/**
 * Compact representation of analysis results for URL sharing.
 * Omits full post data to keep URLs short.
 */
export type ShareableResults = {
  readonly m: readonly ShareableMention[]; // mentions
  readonly t: number; // timestamp (when analysis was created)
};

/**
 * Convert full MentionCount[] to compact ShareableResults.
 * Strips post data to minimize URL size.
 */
export function toShareableResults(mentionCounts: MentionCount[]): ShareableResults {
  return {
    m: mentionCounts.map((mc) => ({
      n: mc.mention,
      c: mc.count,
    })),
    t: Date.now(),
  };
}

/**
 * Encode ShareableResults to a URL-safe compressed string.
 * Uses LZ-string compression with Base64 encoding.
 */
export function encodeResults(results: ShareableResults): string {
  const json = JSON.stringify(results);
  const compressed = LZString.compressToBase64(json);
  return compressed;
}

/**
 * Decode a compressed string back to ShareableResults.
 * Returns null if decoding fails or data is invalid.
 */
export function decodeResults(encoded: string): ShareableResults | null {
  if (!encoded) {
    return null;
  }

  try {
    const decompressed = LZString.decompressFromBase64(encoded);
    if (!decompressed) {
      return null;
    }

    const parsed = JSON.parse(decompressed);

    // Validate structure
    if (!isValidShareableResults(parsed)) {
      return null;
    }

    return parsed as ShareableResults;
  } catch {
    return null;
  }
}

/**
 * Type guard to validate ShareableResults structure.
 */
function isValidShareableResults(obj: unknown): obj is ShareableResults {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const candidate = obj as Record<string, unknown>;

  // Check required fields
  if (!Array.isArray(candidate['m'])) {
    return false;
  }

  if (typeof candidate['t'] !== 'number') {
    return false;
  }

  // Validate each mention
  for (const mention of candidate['m']) {
    if (typeof mention !== 'object' || mention === null) {
      return false;
    }

    const m = mention as Record<string, unknown>;
    if (typeof m['n'] !== 'string' || typeof m['c'] !== 'number') {
      return false;
    }
  }

  return true;
}
