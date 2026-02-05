// pattern: Functional Core
export type MediaType = 'MOVIE' | 'TV_SHOW' | 'MUSIC' | 'UNKNOWN';

export const MediaType = {
  MOVIE: 'MOVIE' as const,
  TV_SHOW: 'TV_SHOW' as const,
  MUSIC: 'MUSIC' as const,
  UNKNOWN: 'UNKNOWN' as const,
};

export type MediaMention = {
  readonly title: string;
  readonly normalizedTitle: string;
  readonly mediaType: MediaType;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly artist?: string; // For music
  readonly context?: string; // Surrounding text for debugging
};

const MOVIE_KEYWORDS = ['watched', 'saw', 'film', 'cinema', 'theater', 'theatre', 'movie'];
const TV_KEYWORDS = ['watching', 'episode', 'season', 'series', 'binge', 'show', 'tv'];
const MUSIC_KEYWORDS = [
  'listening',
  'heard',
  'song',
  'album',
  'artist',
  'track',
  'music',
  'playing',
];

const NOISE_WORDS = new Set([
  'yes',
  'no',
  'okay',
  'ok',
  'hello',
  'world',
  'hi',
  'hey',
  'have',
  'thanks',
  'thank you',
  'please',
]);

// Common English words to skip as single-word matches
const COMMON_WORDS = new Set([
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'be',
  'is',
  'are',
  'was',
  'were',
  'can',
  'could',
  'would',
  'should',
  'may',
  'might',
  'must',
  'shall',
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'if',
  'in',
  'on',
  'at',
  'to',
  'for',
  'art',
  'where',
  'thou',
  'thee',
  'thy',
  'thine', // archaic/poetic
  'brother',
  'o',
  'movie', // common words that shouldn't be standalone mentions
]);

/**
 * Extracts media mentions from natural language text
 * Uses regex patterns + context keywords for classification
 */
export class MentionExtractor {
  /**
   * Extract media mentions from text
   * @param text - Post text to analyze
   * @param defaultMediaType - Media type to use when context is unclear
   */
  extractMentions(text: string, defaultMediaType?: MediaType): Array<MediaMention> {
    const mentions: Array<MediaMention> = [];

    // Strategy 1: Quoted text (high confidence)
    const quotedMentions = this.extractQuoted(text, defaultMediaType);
    mentions.push(...quotedMentions);

    // Strategy 2: Title case (medium confidence)
    const titleCaseMentions = this.extractTitleCase(text, defaultMediaType);
    mentions.push(...titleCaseMentions);

    // Deduplicate by normalized title
    const seen = new Set<string>();
    return mentions.filter((mention) => {
      // Exact match already seen
      if (seen.has(mention.normalizedTitle)) {
        return false;
      }

      // Check if this is a substring of another mention (avoid duplicates like "Where Art Thou" vs "O Brother, Where Art Thou")
      for (const existing of seen) {
        if (
          existing.includes(mention.normalizedTitle) ||
          mention.normalizedTitle.includes(existing)
        ) {
          return false;
        }
      }

      seen.add(mention.normalizedTitle);
      return true;
    });
  }

  /**
   * Normalize title for matching (remove leading articles, lowercase)
   */
  normalizeTitle(title: string): string {
    const articles = ['the', 'a', 'an'];
    const words = title.toLowerCase().split(/\s+/);

    const firstWord = words[0];
    if (words.length > 1 && firstWord && articles.includes(firstWord)) {
      return words.slice(1).join(' ');
    }

    return title.toLowerCase();
  }

  /**
   * Extract quoted text (high confidence)
   */
  private extractQuoted(text: string, defaultMediaType?: MediaType): Array<MediaMention> {
    const mentions: Array<MediaMention> = [];

    // Regex: quoted text - match content between quotes, handling escaped quotes and apostrophes
    const quotedPattern = /"([^"]+)"/g;
    let match;

    while ((match = quotedPattern.exec(text)) !== null) {
      const capturedTitle = match[1];
      if (!capturedTitle) {
        continue;
      }
      const title = capturedTitle.trim();

      // Validate title
      if (!this.isValidTitle(title)) {
        continue;
      }

      // Get context around the quote
      const contextStart = Math.max(0, match.index - 50);
      const contextEnd = Math.min(text.length, match.index + match[0].length + 50);
      const context = text.slice(contextStart, contextEnd);

      // Classify media type from context
      const mediaType = defaultMediaType ?? this.classifyFromContext(context);

      // Extract artist for music
      const artist =
        mediaType === MediaType.MUSIC ? this.extractArtist(text, match.index) : undefined;

      mentions.push({
        title,
        normalizedTitle: this.normalizeTitle(title),
        mediaType,
        confidence: 'high',
        artist,
        context,
      });
    }

    return mentions;
  }

  /**
   * Extract title case text (medium confidence)
   */
  private extractTitleCase(text: string, defaultMediaType?: MediaType): Array<MediaMention> {
    const mentions: Array<MediaMention> = [];

    // Regex: 1+ consecutive capitalized words (with numbers allowed)
    // Single words must be 2+ chars, multi-word sequences can be any length
    const titleCasePattern =
      /\b(?:[A-Z][a-z]+|\d+)(?:\s+(?:[A-Z][a-z]+|\d+))*|\b[A-Z]{2,}(?:\s+[A-Z]{2,})*/g;
    let match;

    while ((match = titleCasePattern.exec(text)) !== null) {
      const title = match[0].trim();

      // Validate title
      if (!this.isValidTitle(title)) {
        continue;
      }

      // Skip common words in single-word matches
      const words = title.split(/\s+/);
      if (words.length === 1) {
        // Single word: skip if common word OR too short (< 5 chars)
        if (COMMON_WORDS.has(title.toLowerCase()) || title.length < 5) {
          continue;
        }
      }

      // Get context
      const contextStart = Math.max(0, match.index - 50);
      const contextEnd = Math.min(text.length, match.index + match[0].length + 50);
      const context = text.slice(contextStart, contextEnd);

      // Classify media type
      const mediaType = defaultMediaType ?? this.classifyFromContext(context);

      mentions.push({
        title,
        normalizedTitle: this.normalizeTitle(title),
        mediaType,
        confidence: 'medium',
        context,
      });
    }

    return mentions;
  }

  /**
   * Classify media type based on context keywords
   */
  private classifyFromContext(context: string): MediaType {
    const contextLower = context.toLowerCase();

    // Count keyword occurrences
    const movieCount = MOVIE_KEYWORDS.filter((kw) => contextLower.includes(kw)).length;
    const tvCount = TV_KEYWORDS.filter((kw) => contextLower.includes(kw)).length;
    const musicCount = MUSIC_KEYWORDS.filter((kw) => contextLower.includes(kw)).length;

    // Return type with most matches
    const max = Math.max(movieCount, tvCount, musicCount);

    if (max === 0) {
      return MediaType.UNKNOWN;
    }

    if (movieCount === max) return MediaType.MOVIE;
    if (tvCount === max) return MediaType.TV_SHOW;
    if (musicCount === max) return MediaType.MUSIC;

    return MediaType.UNKNOWN;
  }

  /**
   * Extract artist name for music mentions
   */
  private extractArtist(text: string, titlePosition: number): string | undefined {
    // Look for " by Artist" pattern after the title
    const afterTitle = text.slice(titlePosition);
    const artistPattern =
      /by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:feat\.|featuring|ft\.|with)\s+.+)?)/;
    const match = artistPattern.exec(afterTitle);

    if (!match || !match[1]) {
      return undefined;
    }
    return match[1].trim();
  }

  /**
   * Validate if a title is valid (not noise, not too short)
   */
  private isValidTitle(title: string): boolean {
    // Too short
    if (title.length < 2) {
      return false;
    }

    // Noise words (including "Hello" and "World")
    const lowerTitle = title.toLowerCase();
    if (NOISE_WORDS.has(lowerTitle)) {
      return false;
    }

    // Filter out very common two-word phrases (all lowercase noise)
    const words = lowerTitle.split(/\s+/);
    if (words.every((w) => NOISE_WORDS.has(w))) {
      return false;
    }

    return true;
  }
}
