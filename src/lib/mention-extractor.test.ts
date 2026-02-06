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

      it('should extract titles with common words joined by connectors', () => {
        // "Master" and "Commander" are both in COMMON_WORDS, but "and" connector signals a title
        const text = 'Master and Commander is a great movie';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(1);
        expect(mentions[0].title).toBe('Master and Commander');
      });

      it('should extract single-word rare titles mid-sentence', () => {
        // Single rare words (not common words, not at sentence start) can be extracted
        // This catches titles like "Ronin", "Inception", "Tenet", "Amélie"
        const textMidSentence = 'Have you seen Inception?';
        const mentionsMid = extractor.extractMentions(textMidSentence, MediaType.MOVIE);
        expect(mentionsMid).toHaveLength(1);
        expect(mentionsMid[0].title).toBe('Inception');
        expect(mentionsMid[0].confidence).toBe('low'); // Low confidence, relies on TMDB validation
      });

      it('should NOT extract single-word titles at sentence start', () => {
        // Sentence-starting words are too noisy even if not in COMMON_WORDS
        const textAtStart = 'Inception was great!';
        const mentionsStart = extractor.extractMentions(textAtStart, MediaType.MOVIE);
        expect(mentionsStart).toHaveLength(0);
      });

      it('should NOT extract common single words even mid-sentence', () => {
        // Words in COMMON_WORDS should never be extracted alone
        const textCommon = 'I think Something is wrong';
        const mentionsCommon = extractor.extractMentions(textCommon, MediaType.MOVIE);
        // "Something" is in COMMON_WORDS
        expect(mentionsCommon.filter((m) => m.title === 'Something')).toHaveLength(0);
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
        // Title must not be at sentence start (would be filtered as sentence-starting word)
        const text = 'I think The Matrix is great';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(1);
        expect(mentions[0].mediaType).toBe(MediaType.MOVIE);
      });

      it('should return UNKNOWN when no context keywords match', () => {
        const text = 'Some random text with "Title" in it';
        const mentions = extractor.extractMentions(text);

        expect(mentions[0].mediaType).toBe(MediaType.UNKNOWN);
      });
    });

    describe('ALL CAPS extraction', () => {
      it('should extract ALL CAPS movie titles', () => {
        const text = 'If STAR TREK II counts, that\'s another one.';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(1);
        expect(mentions[0].title).toBe('Star Trek Ii');
        expect(mentions[0].confidence).toBe('medium');
      });

      it('should extract ALL CAPS with ampersand connector', () => {
        const text = 'And MASTER & COMMANDER is great.';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(1);
        expect(mentions[0].title).toBe('Master & Commander');
      });

      it('should extract ALL CAPS with colon connector', () => {
        const text = 'TOP GUN: MAVERICK was amazing.';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(1);
        expect(mentions[0].title).toBe('Top Gun: Maverick');
      });

      it('should extract multiple ALL CAPS titles from list', () => {
        const text = 'MASTER & COMMANDER, TOP GUN: MAVERICK, and THE LAST OF THE MOHICANS.';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions.length).toBeGreaterThanOrEqual(2);
        const titles = mentions.map((m) => m.title.toLowerCase());
        expect(titles).toContain('master & commander');
      });

      it('should not extract single ALL CAPS words', () => {
        const text = 'I said THE and MOVIE';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(0);
      });

      it('should not extract common ALL CAPS phrases', () => {
        const text = 'THE AND OF IN AT';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(0);
      });

      it('should handle ALL CAPS on newlines', () => {
        const text = 'ROCKY / CREED\nTHE FUGITIVE\nTHE HUNT FOR RED OCTOBER';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        // Should find "Hunt for Red October" (after removing leading "THE" at line start)
        const titles = mentions.map((m) => m.normalizedTitle);
        expect(titles.some((t) => t.includes('hunt') && t.includes('october'))).toBe(true);
      });

      it('should convert ALL CAPS to Title Case', () => {
        const text = 'Check out MASTER & COMMANDER sometime.';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(1);
        // Should be title cased, not ALL CAPS
        expect(mentions[0].title).toBe('Master & Commander');
        expect(mentions[0].title).not.toBe('MASTER & COMMANDER');
      });

      it('should handle Roman numerals in ALL CAPS', () => {
        const text = 'STAR WARS IV and ROCKY III are classics';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions.length).toBeGreaterThanOrEqual(1);
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

  describe('substring deduplication', () => {
    it('should prefer "Hunt for Red October" over "RED"', () => {
      // When both RED and Hunt for Red October are mentioned, keep only the longer one
      const text = 'THE HUNT FOR RED OCTOBER is a classic submarine movie about RED October';
      const mentions = extractor.extractMentions(text, MediaType.MOVIE);

      const titles = mentions.map((m) => m.normalizedTitle);
      // Should have "hunt for red october" but NOT standalone "red"
      expect(titles.some((t) => t.includes('hunt') && t.includes('red') && t.includes('october'))).toBe(true);
      expect(titles.some((t) => t === 'red')).toBe(false);
    });

    it('should prefer "Indiana Jones" over "JONES"', () => {
      // When both JONES and Indiana Jones appear, keep only the longer one
      const text = 'INDIANA JONES is great, JONES is such a cool character';
      const mentions = extractor.extractMentions(text, MediaType.MOVIE);

      const titles = mentions.map((m) => m.normalizedTitle);
      // Should have "indiana jones" but NOT standalone "jones"
      expect(titles.some((t) => t.includes('indiana') && t.includes('jones'))).toBe(true);
      expect(titles.some((t) => t === 'jones')).toBe(false);
    });

    it('should keep both titles when neither is substring of other', () => {
      const text = 'I love THE DARK KNIGHT and TOP GUN: MAVERICK';
      const mentions = extractor.extractMentions(text, MediaType.MOVIE);

      const titles = mentions.map((m) => m.normalizedTitle);
      expect(titles.some((t) => t.includes('dark') && t.includes('knight'))).toBe(true);
      expect(titles.some((t) => t.includes('top') && t.includes('gun'))).toBe(true);
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
    expect(extractor.normalizeTitle('A Star Is Born')).toBe(
      extractor.normalizeTitle('Star Is Born')
    );
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
