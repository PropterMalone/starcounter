import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { MentionExtractor, MediaType } from './mention-extractor';

describe('MentionExtractor', () => {
  const extractor = new MentionExtractor();

  describe('extractMentions', () => {
    describe('quoted text extraction', () => {
      it('should extract quoted movie titles', () => {
        const text = 'I watched "The Matrix" last night';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(1);
        expect(mentions[0].title).toBe('The Matrix');
        expect(mentions[0].mediaType).toBe(MediaType.MOVIE);
        expect(mentions[0].confidence).toBe('high');
      });

      it('should extract multiple quoted titles', () => {
        const text = 'I loved "The Matrix" and "Inception"';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(2);
        expect(mentions.map((m) => m.title)).toContain('The Matrix');
        expect(mentions.map((m) => m.title)).toContain('Inception');
      });

      it('should handle escaped quotes', () => {
        const text = 'The movie "O Brother, Where Art Thou?" was great';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(1);
        expect(mentions[0].title).toBe('O Brother, Where Art Thou?');
      });
    });

    describe('title case extraction', () => {
      it('should extract title case movie titles', () => {
        const text = 'I watched The Dark Knight yesterday';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(1);
        expect(mentions[0].title).toBe('The Dark Knight');
        expect(mentions[0].confidence).toBe('medium');
      });

      it('should handle single-word titles', () => {
        const text = 'Have you seen Inception?';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(1);
        expect(mentions[0].title).toBe('Inception');
      });

      it('should not extract common phrases', () => {
        const text = 'I said Hello World to my friend';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(0);
      });
    });

    describe('context-based classification', () => {
      it('should detect movie context', () => {
        const text = 'I watched The Matrix last night';
        const mentions = extractor.extractMentions(text);

        expect(mentions[0].mediaType).toBe(MediaType.MOVIE);
      });

      it('should detect TV show context', () => {
        const text = 'Watching Breaking Bad episode 5';
        const mentions = extractor.extractMentions(text);

        expect(mentions[0].mediaType).toBe(MediaType.TV_SHOW);
      });

      it('should detect music context', () => {
        const text = 'Listening to Bohemian Rhapsody by Queen';
        const mentions = extractor.extractMentions(text);

        expect(mentions[0].mediaType).toBe(MediaType.MUSIC);
      });

      it('should default to provided media type when context unclear', () => {
        const text = 'The Matrix is great';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions[0].mediaType).toBe(MediaType.MOVIE);
      });
    });

    describe('edge cases', () => {
      it('should handle possessives', () => {
        const text = '"The Matrix"\'s ending was mind-blowing';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions[0].title).toBe('The Matrix');
      });

      it('should handle punctuation in titles', () => {
        const text = '"Don\'t Look Now" is a classic';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions[0].title).toBe("Don't Look Now");
      });

      it('should normalize leading articles', () => {
        const mention1 = extractor.extractMentions('"The Matrix"', MediaType.MOVIE)[0];
        const mention2 = extractor.extractMentions('"Matrix"', MediaType.MOVIE)[0];

        expect(mention1.normalizedTitle).toBe(mention2.normalizedTitle);
      });

      it('should filter very short titles', () => {
        const text = 'I said "Hi" to them';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(0);
      });

      it('should handle numbers in titles', () => {
        const text = '"2001: A Space Odyssey" is brilliant';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions[0].title).toBe('2001: A Space Odyssey');
      });
    });

    describe('music-specific patterns', () => {
      it('should extract song with artist', () => {
        const text = 'Listening to "Bohemian Rhapsody" by Queen';
        const mentions = extractor.extractMentions(text, MediaType.MUSIC);

        expect(mentions[0].title).toBe('Bohemian Rhapsody');
        expect(mentions[0].artist).toBe('Queen');
      });

      it('should handle featured artists', () => {
        const text = '"Song Name" by Artist feat. Featured Artist';
        const mentions = extractor.extractMentions(text, MediaType.MUSIC);

        expect(mentions[0].artist).toBe('Artist feat. Featured Artist');
      });
    });
  });

  describe('normalization', () => {
    it('should normalize titles for matching', () => {
      expect(extractor.normalizeTitle('The Matrix')).toBe('matrix');
      expect(extractor.normalizeTitle('A Star Is Born')).toBe('star is born');
      expect(extractor.normalizeTitle('An Unexpected Journey')).toBe('unexpected journey');
    });

    it('should handle titles without articles', () => {
      expect(extractor.normalizeTitle('Inception')).toBe('inception');
    });
  });
});

describe('MentionExtractor - Property-Based Tests', () => {
  const extractor = new MentionExtractor();

  it('should handle arbitrary quoted strings', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 3, maxLength: 50 }).filter((s) => !s.includes('"')),
        (title) => {
          const text = `I watched "${title}" yesterday`;
          const mentions = extractor.extractMentions(text, MediaType.MOVIE);

          // Should extract the title (if valid)
          if (extractor.normalizeTitle(title).length >= 2) {
            expect(mentions.length).toBeGreaterThanOrEqual(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should produce consistent normalized titles', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 3, maxLength: 30 }), (title) => {
        const normalized1 = extractor.normalizeTitle(title);
        const normalized2 = extractor.normalizeTitle(title);

        // Normalization is idempotent
        expect(normalized1).toBe(normalized2);
      }),
      { numRuns: 100 }
    );
  });

  it('should normalize titles with articles consistently', () => {
    // Test the specific case: "The Matrix" should normalize same as "Matrix"
    expect(extractor.normalizeTitle('The Matrix')).toBe(extractor.normalizeTitle('Matrix'));
    expect(extractor.normalizeTitle('A Star Is Born')).toBe(extractor.normalizeTitle('Star Is Born'));
    expect(extractor.normalizeTitle('An Unexpected Journey')).toBe(
      extractor.normalizeTitle('Unexpected Journey')
    );

    // Property-based: normalize twice is same as normalize once (idempotence)
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), (title) => {
        const normalized1 = extractor.normalizeTitle(title);
        const normalized2 = extractor.normalizeTitle(normalized1);
        expect(normalized1).toBe(normalized2);
      }),
      { numRuns: 100 }
    );
  });

  it('should never extract empty titles', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 100 }), (text) => {
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        // All extracted titles must be non-empty
        mentions.forEach((mention) => {
          expect(mention.title.length).toBeGreaterThan(0);
          expect(mention.normalizedTitle.length).toBeGreaterThan(0);
        });
      }),
      { numRuns: 100 }
    );
  });
});
