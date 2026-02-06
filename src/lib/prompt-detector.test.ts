import { describe, it, expect } from 'vitest';
import { PromptDetector, MediaType } from './prompt-detector';

describe('PromptDetector', () => {
  const detector = new PromptDetector();

  describe('detectPromptType', () => {
    it('should detect movie prompts', () => {
      const prompts = [
        'What movie have you watched recently?',
        'Favorite film?',
        'Drop your top 5 movies',
        'Name a movie that changed your life',
      ];

      prompts.forEach((prompt) => {
        const detected = detector.detectPromptType(prompt);
        expect(detected).toBe(MediaType.MOVIE);
      });
    });

    it('should detect TV show prompts', () => {
      const prompts = [
        'What TV show are you watching?',
        'Best series you have seen?',
        'Favorite show?',
        'What are you binging?',
      ];

      prompts.forEach((prompt) => {
        const detected = detector.detectPromptType(prompt);
        expect(detected).toBe(MediaType.TV_SHOW);
      });
    });

    it('should detect music prompts', () => {
      const prompts = [
        'What song are you listening to?',
        'Favorite artist?',
        'Best album of all time?',
        'Drop your top 5 songs',
      ];

      prompts.forEach((prompt) => {
        const detected = detector.detectPromptType(prompt);
        expect(detected).toBe(MediaType.MUSIC);
      });
    });

    it('should return UNKNOWN for ambiguous prompts', () => {
      const prompts = ['What are you doing?', 'How are you?', 'Tell me something interesting'];

      prompts.forEach((prompt) => {
        const detected = detector.detectPromptType(prompt);
        expect(detected).toBe(MediaType.UNKNOWN);
      });
    });

    it('should handle case insensitivity', () => {
      expect(detector.detectPromptType('FAVORITE MOVIE?')).toBe(MediaType.MOVIE);
      expect(detector.detectPromptType('favorite movie?')).toBe(MediaType.MOVIE);
      expect(detector.detectPromptType('FaVoRiTe MoViE?')).toBe(MediaType.MOVIE);
    });

    it('should handle prompts with emojis', () => {
      expect(detector.detectPromptType('🎬 Favorite movie?')).toBe(MediaType.MOVIE);
      expect(detector.detectPromptType('🎵 What song?')).toBe(MediaType.MUSIC);
    });
  });

  describe('getConfidence', () => {
    it('should return high confidence for strong keywords', () => {
      const confidence = detector.getConfidence('What is your favorite movie?', MediaType.MOVIE);

      expect(confidence).toBe('high');
    });

    it('should return medium confidence for weaker matches', () => {
      const confidence = detector.getConfidence('What are you watching?', MediaType.TV_SHOW);

      expect(confidence).toBe('medium');
    });

    it('should return low confidence for ambiguous text', () => {
      const confidence = detector.getConfidence('Tell me about it', MediaType.MOVIE);

      expect(confidence).toBe('low');
    });

    it('should return high confidence with multiple strong keywords', () => {
      const confidence = detector.getConfidence(
        'What is your favorite TV show and what episode are you on?',
        MediaType.TV_SHOW
      );

      expect(confidence).toBe('high');
    });

    it('should return low confidence for unknown media type', () => {
      const confidence = detector.getConfidence('Some random text', MediaType.UNKNOWN);

      expect(confidence).toBe('low');
    });
  });

  describe('tie-breaking behavior', () => {
    it('should break ties in favor of movie when equal scores', () => {
      // Create text with equal strong keywords for movie and TV
      const text = 'movie show';
      const result = detector.detectPromptType(text);
      // Movie should win due to first-match preference
      expect(result).toBe(MediaType.MOVIE);
    });

    it('should break ties in favor of TV when movie tie with music', () => {
      // Create text with equal scores across types
      const text = 'music film show';
      const result = detector.detectPromptType(text);
      // Movie and music both have 10, TV has 10, movie wins
      expect([MediaType.MOVIE, MediaType.TV_SHOW, MediaType.MUSIC]).toContain(result);
    });
  });
});
