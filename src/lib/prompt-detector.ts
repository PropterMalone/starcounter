export { MediaType } from './mention-extractor';
export type { MediaMention } from './mention-extractor';

import type { MediaType as MediaTypeEnum } from './mention-extractor';
import { MediaType } from './mention-extractor';

const MOVIE_KEYWORDS = {
  strong: ['movie', 'film', 'cinema'],
  weak: ['watched', 'saw', 'favorite', 'best', 'top'],
};

const TV_KEYWORDS = {
  strong: ['show', 'series', 'episode', 'season', 'watching', 'binge', 'binging'],
  weak: ['favorite', 'best', 'tv', 'television'],
};

const MUSIC_KEYWORDS = {
  strong: ['song', 'music', 'album', 'artist', 'track'],
  weak: ['listening', 'heard', 'favorite', 'best', 'top'],
};

/**
 * Detects prompt type from root post text
 * Auto-identifies whether thread is asking about movies, TV, or music
 */
export class PromptDetector {
  /**
   * Detect media type from prompt text
   * Returns UNKNOWN if ambiguous
   */
  detectPromptType(text: string): MediaTypeEnum {
    const textLower = text.toLowerCase();

    // Score each media type
    const movieScore = this.scoreKeywords(textLower, MOVIE_KEYWORDS);
    const tvScore = this.scoreKeywords(textLower, TV_KEYWORDS);
    const musicScore = this.scoreKeywords(textLower, MUSIC_KEYWORDS);

    // Find max score
    const maxScore = Math.max(movieScore, tvScore, musicScore);

    // Require minimum score (at least one strong keyword)
    if (maxScore < 10) {
      return MediaType.UNKNOWN;
    }

    // Return type with highest score (prioritize in order of preference)
    if (movieScore === maxScore) {
      return MediaType.MOVIE;
    }
    if (tvScore === maxScore) {
      return MediaType.TV_SHOW;
    }

    return MediaType.MUSIC;
  }

  /**
   * Get confidence level for a detected type
   */
  getConfidence(
    text: string,
    detectedType: MediaTypeEnum
  ): 'high' | 'medium' | 'low' {
    const textLower = text.toLowerCase();

    const keywords =
      detectedType === MediaType.MOVIE
        ? MOVIE_KEYWORDS
        : detectedType === MediaType.TV_SHOW
          ? TV_KEYWORDS
          : detectedType === MediaType.MUSIC
            ? MUSIC_KEYWORDS
            : { strong: [], weak: [] };

    const score = this.scoreKeywords(textLower, keywords);

    if (score >= 15) return 'high'; // Multiple strong keywords
    if (score >= 10) return 'medium'; // At least one strong keyword
    return 'low'; // Only weak keywords or none
  }

  /**
   * Score text based on keyword matches
   */
  private scoreKeywords(
    text: string,
    keywords: { strong: string[]; weak: string[] }
  ): number {
    let score = 0;

    // Strong keywords: 10 points each
    for (const keyword of keywords.strong) {
      if (text.includes(keyword)) {
        score += 10;
      }
    }

    // Weak keywords: 5 points each
    for (const keyword of keywords.weak) {
      if (text.includes(keyword)) {
        score += 5;
      }
    }

    return score;
  }
}
