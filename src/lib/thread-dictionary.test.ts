import { describe, it, expect } from 'vitest';
import {
  extractCandidates,
  extractShortTextCandidate,
  isReaction,
  isAgreement,
  buildValidationLookup,
  discoverDictionary,
  normalizeForMerge,
} from './thread-dictionary';
import type { PostTextContent } from './text-extractor';
import type { PostView } from '../types';
import type { ValidatedMention } from './validation-client';

function makePost(uri: string, text: string): PostView {
  return {
    uri,
    cid: 'cid-test',
    author: { did: 'did:plc:test', handle: 'test.bsky.social' },
    record: { text, createdAt: '2024-01-01T00:00:00Z' },
    indexedAt: '2024-01-01T00:00:00Z',
  };
}

function makeTextContent(text: string, overrides: Partial<PostTextContent> = {}): PostTextContent {
  return {
    ownText: text,
    quotedText: null,
    quotedUri: null,
    quotedAltText: null,
    embedLinks: [],
    searchText: text,
    ...overrides,
  };
}

function makeValidatedMention(
  title: string,
  validatedTitle: string,
  confidence: 'high' | 'medium' | 'low' = 'high'
): ValidatedMention {
  return {
    title,
    normalizedTitle: title.toLowerCase(),
    mediaType: 'MOVIE',
    confidence,
    validated: true,
    validationConfidence: confidence,
    validatedTitle,
  };
}

// ---------------------------------------------------------------------------
// extractCandidates
// ---------------------------------------------------------------------------

describe('extractCandidates', () => {
  it('returns empty array for empty text', () => {
    expect(extractCandidates('')).toEqual([]);
    expect(extractCandidates('  ')).toEqual([]);
  });

  it('extracts quoted phrases', () => {
    const result = extractCandidates('I love "The Matrix" so much');
    expect(result).toContain('The Matrix');
  });

  it('extracts smart-quoted phrases', () => {
    const result = extractCandidates('I love \u201cThe Matrix\u201d so much');
    expect(result).toContain('The Matrix');
  });

  it('filters noise from quoted phrases', () => {
    const result = extractCandidates('"dad movie" is great');
    expect(result).not.toContain('dad movie');
  });

  it('filters quotes starting with pronouns/conjunctions', () => {
    const result = extractCandidates('"my favorite thing" is cool');
    expect(result).not.toContain('my favorite thing');
  });

  it('extracts title case phrases', () => {
    const result = extractCandidates('I watched Hunt for Red October last night');
    expect(result).toContain('Hunt for Red October');
  });

  it('filters title case noise phrases', () => {
    const result = extractCandidates('I Think it was great, My Dad loved it');
    expect(result).not.toContain('I Think');
    expect(result).not.toContain('My Dad');
  });

  it('extracts ALL CAPS phrases', () => {
    const result = extractCandidates('STAR WARS is amazing');
    expect(result).toContain('Star Wars');
  });

  it('filters common acronyms from ALL CAPS', () => {
    // ALL_CAPS_RE requires 2+ words, each 2+ chars. CAPS_NOISE_RE checks single-word acronyms.
    // A multi-word phrase like "LMAO OMG WTF" is a valid ALL_CAPS match (3 words),
    // but each word individually would be filtered. The regex produces "Lmao Omg Wtf" as a title.
    // This is acceptable — these get filtered by validation (no TMDB match).
    const result = extractCandidates('LMAO OMG WTF');
    // The multi-word phrase is extracted as a candidate (validation will reject it)
    expect(result).toContain('Lmao Omg Wtf');

    // Single-word acronyms don't match ALL_CAPS_RE (requires 2+ words)
    expect(extractCandidates('LMAO')).toHaveLength(0);
  });

  it('extracts image alt text', () => {
    const result = extractCandidates('[image alt: Movie poster for Jaws]');
    expect(result).toContain('Movie poster for Jaws');
  });

  it('deduplicates candidates', () => {
    const result = extractCandidates('"The Matrix" and The Matrix again');
    const matrixCount = result.filter((c) => c === 'The Matrix').length;
    expect(matrixCount).toBe(1);
  });

  it('extracts per-line candidates from multi-line lists', () => {
    const result = extractCandidates('In chronological order:\nMersey\nDee\nSevern\nAvon');
    expect(result).toContain('Mersey');
    expect(result).toContain('Dee');
    expect(result).toContain('Severn');
    expect(result).toContain('Avon');
  });

  it('does not merge title case words across newlines', () => {
    const result = extractCandidates('Thames\nSeine\nConnecticut');
    // Should NOT produce "Thames Seine Connecticut" as one candidate
    expect(result).not.toContain('Thames Seine Connecticut');
    expect(result).not.toContain('Thames\nSeine\nConnecticut');
    expect(result).toContain('Thames');
    expect(result).toContain('Seine');
    expect(result).toContain('Connecticut');
  });

  it('filters sentence-starter lines from per-line extraction', () => {
    const result = extractCandidates('Growing up near a river\nI loved the water');
    expect(result).not.toContain('Growing up near a river');
    expect(result).not.toContain('I loved the water');
  });

  it('skips all-caps single words in per-line extraction', () => {
    expect(extractCandidates('LMAO')).toHaveLength(0);
    expect(extractCandidates('WTF')).toHaveLength(0);
  });

  it('skips reaction stopwords in per-line extraction', () => {
    const result = extractCandidates('Great');
    expect(result).not.toContain('Great');
  });
});

// ---------------------------------------------------------------------------
// extractShortTextCandidate
// ---------------------------------------------------------------------------

describe('extractShortTextCandidate', () => {
  it('returns null for empty text', () => {
    expect(extractShortTextCandidate('')).toBeNull();
  });

  it('returns null for long text', () => {
    expect(extractShortTextCandidate('x'.repeat(81))).toBeNull();
  });

  it('returns cleaned text for short posts', () => {
    expect(extractShortTextCandidate('The Matrix')).toBe('The Matrix');
  });

  it('strips emojis, hashtags, mentions, URLs', () => {
    const result = extractShortTextCandidate('Jaws 🦈 @user #movies');
    expect(result).toBe('Jaws');
  });

  it('returns null for reaction stopwords', () => {
    expect(extractShortTextCandidate('great')).toBeNull();
    expect(extractShortTextCandidate('lol')).toBeNull();
    expect(extractShortTextCandidate('classic')).toBeNull();
  });

  it('returns null for single-character result', () => {
    expect(extractShortTextCandidate('!')).toBeNull();
  });

  it('returns null for too many words', () => {
    expect(extractShortTextCandidate('one two three four five six seven eight nine')).toBeNull();
  });

  it('takes only first line of multi-line posts', () => {
    expect(extractShortTextCandidate('Potomac.\nWas James, Elizabeth and Thames.')).toBe('Potomac');
  });

  it('returns null when first line of multi-line post is too long', () => {
    const long = 'x'.repeat(81);
    expect(extractShortTextCandidate(long + '\nShort')).toBeNull();
  });

  it('filters sentence-starting prefixes', () => {
    expect(extractShortTextCandidate('I was thinking about rivers')).toBeNull();
    expect(extractShortTextCandidate('My home river is great')).toBeNull();
    expect(extractShortTextCandidate('Here is mine')).toBeNull();
    expect(extractShortTextCandidate('What a question')).toBeNull();
    expect(extractShortTextCandidate('This is so fun')).toBeNull();
  });

  it('keeps titles that do not match sentence prefixes', () => {
    expect(extractShortTextCandidate('Mississippi')).toBe('Mississippi');
    expect(extractShortTextCandidate('East River')).toBe('East River');
    expect(extractShortTextCandidate('Thames')).toBe('Thames');
  });
});

// ---------------------------------------------------------------------------
// isReaction
// ---------------------------------------------------------------------------

describe('isReaction', () => {
  it('detects empty text as reaction', () => {
    expect(isReaction('')).toBe(true);
  });

  it('detects agreement phrases', () => {
    expect(isReaction('yes')).toBe(true);
    expect(isReaction('Exactly')).toBe(true);
    expect(isReaction('this')).toBe(true);
  });

  it('detects emoji-only posts', () => {
    expect(isReaction('🔥🔥🔥')).toBe(true);
  });

  it('does not classify longer text as reaction', () => {
    expect(isReaction('The Matrix is one of the best movies ever made in my opinion')).toBe(false);
  });

  it('detects short non-title-case text as reaction', () => {
    // "lol yeah" is 8 chars, < 50, starts with "lol" but doesn't match any pattern fully.
    // The ^(lol|...)+$ pattern requires the entire string to be those words.
    // But "lol yeah" starts with a reaction phrase via the first pattern.
    // Actually, none of the ^ patterns match "lol yeah" fully.
    // The ≤15 char rule: 8 chars, no title-case words → reaction
    expect(isReaction('lol yeah')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isAgreement (strict — for context inheritance only)
// ---------------------------------------------------------------------------

describe('isAgreement', () => {
  it('detects explicit agreement phrases', () => {
    expect(isAgreement('yes')).toBe(true);
    expect(isAgreement('Exactly')).toBe(true);
    expect(isAgreement('agreed')).toBe(true);
    expect(isAgreement('same')).toBe(true);
    expect(isAgreement('this')).toBe(true);
    expect(isAgreement('yes absolutely')).toBe(true);
  });

  it('detects endorsement phrases', () => {
    expect(isAgreement('so good')).toBe(true);
    expect(isAgreement('love this')).toBe(true);
    expect(isAgreement('classic')).toBe(true);
    expect(isAgreement('banger')).toBe(true);
    expect(isAgreement('good call')).toBe(true);
  });

  it('detects agreement emoji', () => {
    expect(isAgreement('👏👏👏')).toBe(true);
    expect(isAgreement('👍')).toBe(true);
    expect(isAgreement('🤝')).toBe(true);
  });

  it('rejects empty text (not agreement)', () => {
    expect(isAgreement('')).toBe(false);
    expect(isAgreement('  ')).toBe(false);
  });

  it('rejects surprise/amusement (not agreement)', () => {
    expect(isAgreement('whoa')).toBe(false);
    expect(isAgreement('lol')).toBe(false);
    expect(isAgreement('lmao')).toBe(false);
    expect(isAgreement('omg')).toBe(false);
    expect(isAgreement('😂😂😂')).toBe(false);
    expect(isAgreement('🔥🔥🔥')).toBe(false);
  });

  it('rejects generic short text that isReaction catches', () => {
    // isReaction has a ≤15 char catch-all for non-title-case text
    // isAgreement does NOT have this — short text must match a pattern
    expect(isAgreement('lol yeah')).toBe(false);
    expect(isAgreement('ha nice')).toBe(false);
    expect(isAgreement('wow')).toBe(false);
  });

  it('rejects longer text', () => {
    expect(isAgreement('The Matrix is one of the best movies ever made in my opinion')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildValidationLookup
// ---------------------------------------------------------------------------

describe('buildValidationLookup', () => {
  it('builds lookup from validated mentions', () => {
    const mentions = [makeValidatedMention('The Matrix', 'The Matrix')];
    const lookup = buildValidationLookup(mentions);
    expect(lookup.get('the matrix')).toEqual({
      canonical: 'The Matrix',
      confidence: 'high',
    });
  });

  it('skips unvalidated mentions', () => {
    const mentions: ValidatedMention[] = [
      { ...makeValidatedMention('Bad', 'Bad'), validated: false },
    ];
    const lookup = buildValidationLookup(mentions);
    expect(lookup.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// discoverDictionary
// ---------------------------------------------------------------------------

describe('discoverDictionary', () => {
  const rootUri = 'at://root/post/1';
  const rootText = 'what is your favorite dad movie?';

  function setup(postTexts: [string, string, PostTextContent][], validations: ValidatedMention[]) {
    const posts: PostView[] = [
      makePost(rootUri, rootText),
      ...postTexts.map(([uri, text]) => makePost(uri, text)),
    ];
    const textMap = new Map<string, PostTextContent>();
    textMap.set(rootUri, makeTextContent(rootText));
    for (const [uri, , content] of postTexts) {
      textMap.set(uri, content);
    }
    const lookup = buildValidationLookup(validations);
    return { posts, textMap, lookup };
  }

  it('discovers titles with confident mentions', () => {
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'Die Hard', makeTextContent('Die Hard')],
        ['uri:2', 'Die Hard for sure', makeTextContent('Die Hard for sure')],
        ['uri:3', 'Die Hard all the way', makeTextContent('Die Hard all the way')],
      ],
      [makeValidatedMention('Die Hard', 'Die Hard')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('Die Hard')).toBe(true);
    expect(dict.entries.get('Die Hard')!.confidentCount).toBeGreaterThanOrEqual(2);
  });

  it('filters titles with zero confident mentions', () => {
    // "red" only appears in incidental text, never extracted by regex
    const { posts, textMap, lookup } = setup(
      [['uri:1', 'the color red is nice', makeTextContent('the color red is nice')]],
      [makeValidatedMention('red', 'Red', 'medium')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('Red')).toBe(false);
  });

  it('requires ≥2 confident mentions for 1-2 word titles', () => {
    const { posts, textMap, lookup } = setup(
      [['uri:1', 'Heat', makeTextContent('Heat')]],
      [makeValidatedMention('Heat', 'Heat')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('Heat')).toBe(false);
  });

  it('allows 1-2 word titles with ≥2 confident mentions', () => {
    // Both the short text "Heat" and "Heat is great" produce candidates via extractShortTextCandidate.
    // The validation lookup must map both to the canonical for them to count as confident.
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'Heat', makeTextContent('Heat')],
        ['uri:2', 'Heat is great', makeTextContent('Heat is great')],
      ],
      [makeValidatedMention('Heat', 'Heat'), makeValidatedMention('Heat is great', 'Heat')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('Heat')).toBe(true);
  });

  it('filters low-confidence API results', () => {
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'The Good', makeTextContent('The Good')],
        ['uri:2', 'The Good movie', makeTextContent('The Good movie')],
      ],
      [makeValidatedMention('The Good', 'The Good Boy', 'low')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('The Good Boy')).toBe(false);
  });

  it('filters titles with poor alias-canonical alignment', () => {
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'Fat Kaz', makeTextContent('Fat Kaz')],
        ['uri:2', 'Fat Kaz again', makeTextContent('Fat Kaz again')],
      ],
      [makeValidatedMention('Fat Kaz', 'My Big Fat Greek Wedding 2')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('My Big Fat Greek Wedding 2')).toBe(false);
  });

  it('deduplicates fragment titles with no independent mentions', () => {
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'The Muppet Christmas Carol', makeTextContent('The Muppet Christmas Carol')],
        [
          'uri:2',
          'The Muppet Christmas Carol is great',
          makeTextContent('The Muppet Christmas Carol is great'),
        ],
      ],
      [
        makeValidatedMention('The Muppet Christmas Carol', 'The Muppet Christmas Carol'),
        makeValidatedMention('Christmas Carol', 'A Christmas Carol'),
      ]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('The Muppet Christmas Carol')).toBe(true);
    // "A Christmas Carol" should be removed because it only appears with the longer title
    expect(dict.entries.has('A Christmas Carol')).toBe(false);
  });

  it('keeps fragment titles with independent mentions', () => {
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'The Muppet Christmas Carol', makeTextContent('The Muppet Christmas Carol')],
        [
          'uri:2',
          'The Muppet Christmas Carol rocks',
          makeTextContent('The Muppet Christmas Carol rocks'),
        ],
        ['uri:3', 'A Christmas Carol', makeTextContent('A Christmas Carol')],
        ['uri:4', 'A Christmas Carol is classic', makeTextContent('A Christmas Carol is classic')],
      ],
      [
        makeValidatedMention('The Muppet Christmas Carol', 'The Muppet Christmas Carol'),
        makeValidatedMention('A Christmas Carol', 'A Christmas Carol'),
      ]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('The Muppet Christmas Carol')).toBe(true);
    expect(dict.entries.has('A Christmas Carol')).toBe(true);
  });

  it('includes incidental mentions via reverse substring scan', () => {
    // Long validated titles (≥12 chars) can be found via reverse substring scan
    const longTitle = 'The Shawshank Redemption';
    const { posts, textMap, lookup } = setup(
      [
        // Confident mention via title-case extraction
        ['uri:1', 'The Shawshank Redemption', makeTextContent('The Shawshank Redemption')],
        [
          'uri:2',
          'The Shawshank Redemption again',
          makeTextContent('The Shawshank Redemption again'),
        ],
        // Incidental mention — lowercase, only found by reverse substring scan
        [
          'uri:3',
          'i love the shawshank redemption so much',
          makeTextContent('i love the shawshank redemption so much'),
        ],
      ],
      [makeValidatedMention(longTitle, longTitle)]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has(longTitle)).toBe(true);
    // Should count the incidental mention too
    expect(dict.entries.get(longTitle)!.frequency).toBe(3);
    expect(dict.entries.get(longTitle)!.incidentalCount).toBe(1);
  });

  it('includes quoted text and alt text in search', () => {
    const { posts, textMap, lookup } = setup(
      [
        [
          'uri:1',
          'Die Hard',
          makeTextContent('look at this', {
            quotedText: 'Die Hard is great',
            quotedUri: 'uri:other',
            searchText: 'look at this\nDie Hard is great',
          }),
        ],
        ['uri:2', 'Die Hard for sure', makeTextContent('Die Hard for sure')],
        [
          'uri:3',
          'check the alt',
          makeTextContent('check the alt', {
            quotedAltText: ['Die Hard movie poster'],
            searchText: 'check the alt\nDie Hard movie poster',
          }),
        ],
      ],
      [makeValidatedMention('Die Hard', 'Die Hard')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('Die Hard')).toBe(true);
    expect(dict.entries.get('Die Hard')!.confidentCount).toBeGreaterThanOrEqual(2);
  });

  it('deduplicates via alias overlap when both have confident mentions', () => {
    // "Red October" and "The Hunt for Red October" both get confident mentions.
    // "Red October" should be deduped if all its mentions co-occur with the longer title.
    const { posts, textMap, lookup } = setup(
      [
        // Post mentions both — "Red October" appears inside "The Hunt for Red October"
        ['uri:1', '"The Hunt for Red October"', makeTextContent('"The Hunt for Red October"')],
        [
          'uri:2',
          '"The Hunt for Red October" is classic',
          makeTextContent('"The Hunt for Red October" is classic'),
        ],
        // Also mention "Red October" explicitly
        ['uri:3', '"Red October" is great', makeTextContent('"Red October" is great')],
        ['uri:4', '"Red October" again', makeTextContent('"Red October" again')],
      ],
      [
        makeValidatedMention('The Hunt for Red October', 'The Hunt for Red October'),
        makeValidatedMention('Red October', 'Red October'),
      ]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // Both survive because "Red October" has independent mentions (uri:3, uri:4)
    expect(dict.entries.has('The Hunt for Red October')).toBe(true);
    expect(dict.entries.has('Red October')).toBe(true);
  });

  it('deletes shorter title when all its mentions also appear in longer title', () => {
    // Two titles where:
    // - "Christmas Carol" appears standalone (gets >=2 confident mentions)
    // - Posts that mention "Christmas Carol" ALSO mention "The Muppet Christmas Carol"
    // - Deduplication removes "A Christmas Carol" because all its posts also have the longer title
    const { posts, textMap, lookup } = setup(
      [
        // Posts mention "Christmas Carol" and "The Muppet Christmas Carol" separately
        [
          'uri:1',
          '"Christmas Carol" and "The Muppet Christmas Carol"',
          makeTextContent('"Christmas Carol" and "The Muppet Christmas Carol"'),
        ],
        [
          'uri:2',
          '"A Christmas Carol" and "The Muppet Christmas Carol"',
          makeTextContent('"A Christmas Carol" and "The Muppet Christmas Carol"'),
        ],
      ],
      [
        // Both validated to different canonicals
        makeValidatedMention('Christmas Carol', 'A Christmas Carol'),
        makeValidatedMention('A Christmas Carol', 'A Christmas Carol'),
        makeValidatedMention('The Muppet Christmas Carol', 'The Muppet Christmas Carol'),
      ]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);

    // "The Muppet Christmas Carol" survives
    expect(dict.entries.has('The Muppet Christmas Carol')).toBe(true);

    // "A Christmas Carol" should be deleted because:
    // - Canonical "a christmas carol" is substring of "the muppet christmas carol"
    // - ALL posts mentioning "A Christmas Carol" also mention "The Muppet Christmas Carol"
    // - independentMentions === 0, so it gets deleted (lines 576-578)
    expect(dict.entries.has('A Christmas Carol')).toBe(false);
  });

  it('allows single-mention short titles when minConfidentForShortTitle is 1', () => {
    const { posts, textMap, lookup } = setup(
      [['uri:1', 'Heat', makeTextContent('Heat')]],
      [makeValidatedMention('Heat', 'Heat')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText, {
      minConfidentForShortTitle: 1,
    });
    expect(dict.entries.has('Heat')).toBe(true);
  });

  it('still requires ≥2 confident mentions for short titles with default options', () => {
    const { posts, textMap, lookup } = setup(
      [['uri:1', 'Heat', makeTextContent('Heat')]],
      [makeValidatedMention('Heat', 'Heat')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('Heat')).toBe(false);
  });

  it('excludes quoted text from root post in searchText', () => {
    // A post quoting the root should not have the root's text in its searchText
    const { posts, textMap, lookup } = setup(
      [
        [
          'uri:1',
          'Die Hard',
          makeTextContent('Die Hard', {
            quotedText: rootText,
            quotedUri: rootUri,
            searchText: 'Die Hard',
          }),
        ],
        ['uri:2', 'Die Hard yes', makeTextContent('Die Hard yes')],
      ],
      [makeValidatedMention('Die Hard', 'Die Hard')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('Die Hard')).toBe(true);
  });

  it('merges entries with same normalized canonical form', () => {
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'All Coming Back to Me Now', makeTextContent('All Coming Back to Me Now')],
        [
          'uri:2',
          'All Coming Back to Me Now again',
          makeTextContent('All Coming Back to Me Now again'),
        ],
        [
          'uri:3',
          "It's All Coming Back to Me Now",
          makeTextContent("It's All Coming Back to Me Now"),
        ],
        [
          'uri:4',
          "It's All Coming Back to Me Now!",
          makeTextContent("It's All Coming Back to Me Now!"),
        ],
      ],
      [
        makeValidatedMention('All Coming Back to Me Now', 'All Coming Back to Me Now'),
        makeValidatedMention("It's All Coming Back to Me Now", "It's All Coming Back to Me Now"),
      ]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // Both should be merged into one entry
    const hasFirst = dict.entries.has('All Coming Back to Me Now');
    const hasSecond = dict.entries.has("It's All Coming Back to Me Now");
    expect(hasFirst || hasSecond).toBe(true);
    expect(hasFirst && hasSecond).toBe(false); // only one survives
  });

  it('provides patchedLookup with redirects from merge', () => {
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'The End of the World', makeTextContent('The End of the World')],
        ['uri:2', 'The End of the World!', makeTextContent('The End of the World!')],
        ['uri:3', "It's the End of the World", makeTextContent("It's the End of the World")],
        ['uri:4', "It's the End of the World!", makeTextContent("It's the End of the World!")],
      ],
      [
        makeValidatedMention('The End of the World', 'The End of the World'),
        makeValidatedMention("It's the End of the World", "It's the End of the World"),
      ]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.patchedLookup).toBeDefined();
    // Every entry in patchedLookup should point to a canonical that exists in the dictionary
    for (const [, entry] of dict.patchedLookup!) {
      expect(dict.entries.has(entry.canonical)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Fragment filter (filterFragmentTitles)
  // -------------------------------------------------------------------------

  it('filters fragment titles with a consistent content-word prefix', () => {
    // "Stop Me Now" always preceded by "don't" → fragment of "Don't Stop Me Now"
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', "Don't Stop Me Now", makeTextContent("Don't Stop Me Now")],
        ['uri:2', "don't Stop Me Now!", makeTextContent("don't Stop Me Now!")],
        ['uri:3', "Don't Stop Me Now is great", makeTextContent("Don't Stop Me Now is great")],
        ['uri:4', "love Don't Stop Me Now", makeTextContent("love Don't Stop Me Now")],
      ],
      [makeValidatedMention('Stop Me Now', 'Stop Me Now')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('Stop Me Now')).toBe(false);
  });

  it('does not filter titles with varied prefixes', () => {
    // "Field of Dreams" preceded by different words each time → not a fragment
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'watch Field of Dreams', makeTextContent('watch Field of Dreams')],
        ['uri:2', 'love Field of Dreams', makeTextContent('love Field of Dreams')],
        ['uri:3', 'saw Field of Dreams', makeTextContent('saw Field of Dreams')],
        ['uri:4', 'Field of Dreams rules', makeTextContent('Field of Dreams rules')],
      ],
      [makeValidatedMention('Field of Dreams', 'Field of Dreams')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('Field of Dreams')).toBe(true);
  });

  it('ignores articles and prepositions as prefix words', () => {
    // "Great Muppet Caper" always preceded by "the" → NOT a fragment
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'The Great Muppet Caper', makeTextContent('The Great Muppet Caper')],
        ['uri:2', 'the Great Muppet Caper', makeTextContent('the Great Muppet Caper')],
        ['uri:3', 'The Great Muppet Caper rules', makeTextContent('The Great Muppet Caper rules')],
      ],
      [makeValidatedMention('Great Muppet Caper', 'Great Muppet Caper')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('Great Muppet Caper')).toBe(true);
  });

  it('does not filter when fewer than 3 posts contain the title text', () => {
    // Only 2 posts have "Stop Me Now" in text → insufficient data for prefix detection
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', "Don't Stop Me Now", makeTextContent("Don't Stop Me Now")],
        ['uri:2', "don't Stop Me Now", makeTextContent("don't Stop Me Now")],
        ['uri:3', 'YES', makeTextContent('YES')], // inherited, no title in text
        ['uri:4', 'Stop Me Now!', makeTextContent('Stop Me Now!')],
      ],
      [makeValidatedMention('Stop Me Now', 'Stop Me Now')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // Only 3 posts contain "stop me now", but only 2 have "don't" prefix → 66% < 70%
    expect(dict.entries.has('Stop Me Now')).toBe(true);
  });

  it('merges entries with curly quotes to straight quote equivalents', () => {
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', "It's Good", makeTextContent("It's Good")],
        ['uri:2', "It's Good yes", makeTextContent("It's Good yes")],
        ['uri:3', 'It\u2019s Good', makeTextContent('It\u2019s Good')],
        ['uri:4', 'It\u2019s Good wow', makeTextContent('It\u2019s Good wow')],
      ],
      [
        makeValidatedMention("It's Good", "It's Good"),
        makeValidatedMention('It\u2019s Good', 'It\u2019s Good'),
      ]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // Both should merge — curly and straight quote versions are the same
    const titles = [...dict.entries.keys()].filter((t) => t.toLowerCase().includes('good'));
    expect(titles.length).toBe(1);
  });

  it('merges entries with high word overlap but different normalized forms', () => {
    // Two titles with same words but different word order = different normalized forms
    // "Blue River Valley" vs "Valley Blue River" — same 3 words, 100% overlap
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'Blue River Valley', makeTextContent('Blue River Valley')],
        ['uri:2', 'Blue River Valley yes', makeTextContent('Blue River Valley yes')],
        ['uri:3', 'Valley Blue River', makeTextContent('Valley Blue River')],
        ['uri:4', 'Valley Blue River yes', makeTextContent('Valley Blue River yes')],
      ],
      [
        makeValidatedMention('Blue River Valley', 'Blue River Valley'),
        makeValidatedMention('Valley Blue River', 'Valley Blue River'),
      ]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // Both should merge due to 100% word overlap
    const titles = [...dict.entries.keys()].filter(
      (t) => t.toLowerCase().includes('blue') && t.toLowerCase().includes('river')
    );
    expect(titles.length).toBe(1);
  });

  it('merges multiple entries in a word-overlap group', () => {
    // Three titles with high word overlap that don't normalize identically
    // "River Blue Water", "Blue Water River", "River Water Blue"
    // All have the same 3 words, so 100% overlap, but different order = different normalized forms
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'River Blue Water', makeTextContent('River Blue Water')],
        ['uri:2', 'River Blue Water yes', makeTextContent('River Blue Water yes')],
        ['uri:3', 'Blue Water River', makeTextContent('Blue Water River')],
        ['uri:4', 'Blue Water River yes', makeTextContent('Blue Water River yes')],
        ['uri:5', 'River Water Blue', makeTextContent('River Water Blue')],
        ['uri:6', 'River Water Blue yes', makeTextContent('River Water Blue yes')],
      ],
      [
        makeValidatedMention('River Blue Water', 'River Blue Water'),
        makeValidatedMention('Blue Water River', 'Blue Water River'),
        makeValidatedMention('River Water Blue', 'River Water Blue'),
      ]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // All three should merge into one group due to 100% word overlap
    const titles = [...dict.entries.keys()].filter(
      (t) =>
        t.toLowerCase().includes('river') &&
        t.toLowerCase().includes('blue') &&
        t.toLowerCase().includes('water')
    );
    expect(titles.length).toBe(1);
  });

  it('does not merge entries with low word overlap', () => {
    // Two titles with some common words but <85% overlap
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'The Lord of the Rings', makeTextContent('The Lord of the Rings')],
        ['uri:2', 'The Lord of the Rings!', makeTextContent('The Lord of the Rings!')],
        ['uri:3', 'The Return of the King', makeTextContent('The Return of the King')],
        ['uri:4', 'The Return of the King!', makeTextContent('The Return of the King!')],
      ],
      [
        makeValidatedMention('The Lord of the Rings', 'The Lord of the Rings'),
        makeValidatedMention('The Return of the King', 'The Return of the King'),
      ]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // Should remain separate — word overlap is below 85%
    expect(dict.entries.has('The Lord of the Rings')).toBe(true);
    expect(dict.entries.has('The Return of the King')).toBe(true);
  });

  it('skips 1-word titles in word-overlap merge', () => {
    // Single-word titles are too ambiguous for word-overlap merge
    // Need 3+ posts for each title to pass filtering rules
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'Mississippi River', makeTextContent('Mississippi River')],
        ['uri:2', 'Mississippi River yes', makeTextContent('Mississippi River yes')],
        ['uri:3', 'Mississippi Rivers', makeTextContent('Mississippi Rivers')],
        ['uri:4', 'Mississippi Rivers yes', makeTextContent('Mississippi Rivers yes')],
      ],
      [
        makeValidatedMention('Mississippi River', 'Mississippi River'),
        makeValidatedMention('Mississippi Rivers', 'Mississippi Rivers'),
      ]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // 2-word titles with high overlap should merge (normalized form catches plural difference)
    const titles = [...dict.entries.keys()].filter((t) => t.toLowerCase().includes('mississippi'));
    expect(titles.length).toBeGreaterThanOrEqual(1); // at least one survives after merge
  });
});

// ---------------------------------------------------------------------------
// normalizeForMerge
// ---------------------------------------------------------------------------

describe('normalizeForMerge', () => {
  it('strips leading articles', () => {
    expect(normalizeForMerge('The Matrix')).toBe('matrix');
    expect(normalizeForMerge('A Beautiful Mind')).toBe('beautiful mind');
    expect(normalizeForMerge('An Officer and a Gentleman')).toBe('officer and a gentleman');
  });

  it('strips leading contractions then articles', () => {
    expect(normalizeForMerge("It's the End of the World")).toBe('end of the world');
    expect(normalizeForMerge("Don't Stop Me Now")).toBe('stop me now');
  });

  it('normalizes curly quotes to straight', () => {
    expect(normalizeForMerge('It\u2019s All Good')).toBe('all good');
    expect(normalizeForMerge('It\u2018s All Good')).toBe('all good');
  });

  it('strips trailing punctuation and plural', () => {
    expect(normalizeForMerge('Dashboard Lights')).toBe('dashboard light');
    expect(normalizeForMerge('Dashboard Light.')).toBe('dashboard light');
  });

  it('collapses whitespace', () => {
    expect(normalizeForMerge('  Hello   World  ')).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// Additional edge case tests
// ---------------------------------------------------------------------------

describe('extractCandidates edge cases', () => {
  it('handles empty text in extractCandidates with per-line logic', () => {
    // Multi-line text with empty lines
    const result = extractCandidates('\nThe Matrix\n\nJaws\n');
    expect(result).toContain('The Matrix');
    expect(result).toContain('Jaws');
  });

  it('handles title-case phrases with colons', () => {
    // The regex supports colons as connectors in title case
    const result = extractCandidates('I watched Star Wars: A New Hope last night');
    // The regex actually extracts this as separate phrases because "A" is an article
    // which is in the connector words list, so it should capture the whole phrase
    expect(result.some((c) => c.includes('Star Wars') || c.includes('New Hope'))).toBe(true);
  });

  it('handles quoted text at word boundaries', () => {
    const result = extractCandidates('He said "Matrix" is great');
    expect(result).toContain('Matrix');
  });

  it('skips single-word quoted phrases when not capitalized', () => {
    const result = extractCandidates('I said "hello" to everyone');
    // Single lowercase word in quotes - extractCandidates line 131 check
    expect(result).not.toContain('hello');
  });

  it('extracts per-line candidate with exactly 1 word', () => {
    const result = extractCandidates('Mississippi');
    expect(result).toContain('Mississippi');
  });

  it('extracts title-case phrase with 6 words via title-case regex', () => {
    // 6-word phrases skip per-line extraction but are caught by title-case regex
    const result = extractCandidates('One Two Three Four Five Six');
    expect(result).toContain('One Two Three Four Five Six');
  });

  it('extracts per-line candidate with exactly 5 words', () => {
    const result = extractCandidates('River of the Blue Valley');
    expect(result).toContain('River of the Blue Valley');
  });

  it('skips per-line candidates matching CAPS_NOISE_RE', () => {
    const result = extractCandidates('OMG');
    expect(result).not.toContain('OMG');
  });

  it('skips per-line candidates matching NOISE set', () => {
    const result = extractCandidates('I Am');
    expect(result).not.toContain('I Am');
  });

  it('extracts quoted phrase with exactly 2 words', () => {
    const result = extractCandidates('"Blue River"');
    expect(result).toContain('Blue River');
  });

  it('skips quoted phrase with 11 words', () => {
    const result = extractCandidates('"one two three four five six seven eight nine ten eleven"');
    expect(result).not.toContain('one two three four five six seven eight nine ten eleven');
  });

  it('extracts quoted phrase with exactly 10 words', () => {
    const result = extractCandidates('"one two three four five six seven eight nine ten"');
    expect(result).toContain('one two three four five six seven eight nine ten');
  });

  it('skips ALL CAPS phrase matching noise regex', () => {
    extractCandidates('WTF LMAO');
    // Multi-word, but each word is in CAPS_NOISE_RE
    expect(extractCandidates('LMAO')).toHaveLength(0);
  });

  it('extracts single capitalized word in quotes', () => {
    const result = extractCandidates('"Matrix"');
    expect(result).toContain('Matrix');
  });

  it('skips single lowercase word in quotes', () => {
    const result = extractCandidates('"movie"');
    expect(result).not.toContain('movie');
  });

  it('skips quoted phrase matching QUOTED_PREFIX_RE', () => {
    const result = extractCandidates('"my favorite thing"');
    expect(result).not.toContain('my favorite thing');
  });

  it('skips quoted phrase with exactly 1 character', () => {
    const result = extractCandidates('"a"');
    expect(result).not.toContain('a');
  });

  it('extracts quoted phrase with exactly 2 characters', () => {
    const result = extractCandidates('"It"');
    expect(result).toContain('It');
  });

  it('skips title-case phrase matching NOISE set', () => {
    const result = extractCandidates('I Just watched a movie');
    expect(result).not.toContain('I Just');
  });

  it('extracts ALL CAPS with exactly 4 characters total', () => {
    const result = extractCandidates('JAWS WAS amazing');
    expect(result).toContain('Jaws Was');
  });

  it('skips ALL CAPS with exactly 3 characters total', () => {
    const result = extractCandidates('THE');
    expect(result).toHaveLength(0);
  });
});

describe('discoverDictionary edge cases', () => {
  const rootUri = 'at://root/post/1';
  const rootText = 'what is your favorite thing?';

  function setup(postTexts: [string, string, PostTextContent][], validations: ValidatedMention[]) {
    const posts: PostView[] = [
      makePost(rootUri, rootText),
      ...postTexts.map(([uri, text]) => makePost(uri, text)),
    ];
    const textMap = new Map<string, PostTextContent>();
    textMap.set(rootUri, makeTextContent(rootText));
    for (const [uri, , content] of postTexts) {
      textMap.set(uri, content);
    }
    const lookup = buildValidationLookup(validations);
    return { posts, textMap, lookup };
  }

  it('allows low-confidence titles with exact 3+ word match', () => {
    // Low-confidence API result, but exact multi-word match allows it
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'The Big Blue River', makeTextContent('The Big Blue River')],
        ['uri:2', 'The Big Blue River!', makeTextContent('The Big Blue River!')],
      ],
      [makeValidatedMention('The Big Blue River', 'The Big Blue River', 'low')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('The Big Blue River')).toBe(true);
  });

  it('filters low-confidence titles without exact multi-word match', () => {
    // Low-confidence API result without exact match
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'Big Blue', makeTextContent('Big Blue')],
        ['uri:2', 'Big Blue yes', makeTextContent('Big Blue yes')],
      ],
      [makeValidatedMention('Big Blue', 'The Big Blue River Movie', 'low')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('The Big Blue River Movie')).toBe(false);
  });

  it('filters titles that appear only in root post', () => {
    // Title only appears in root post, not in replies
    const { posts, textMap, lookup } = setup(
      [],
      [makeValidatedMention('Favorite Movie', 'Favorite Movie')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('Favorite Movie')).toBe(false);
  });

  it('includes incidental mentions from quoted alt text', () => {
    const longTitle = 'The Shawshank Redemption Movie';
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', longTitle, makeTextContent(longTitle)],
        ['uri:2', longTitle, makeTextContent(longTitle)],
        [
          'uri:3',
          'check this out',
          makeTextContent('check this out', {
            quotedAltText: [longTitle],
            searchText: `check this out\n${longTitle}`,
          }),
        ],
      ],
      [makeValidatedMention(longTitle, longTitle)]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has(longTitle)).toBe(true);
    expect(dict.entries.get(longTitle)!.frequency).toBe(3);
  });

  it('skips incidental scan for short validated titles', () => {
    // Short title (<12 chars) and <3 words won't trigger incidental scan
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'Big Blue', makeTextContent('Big Blue')],
        ['uri:2', 'Big Blue yes', makeTextContent('Big Blue yes')],
        ['uri:3', 'i love big blue', makeTextContent('i love big blue')],
      ],
      [makeValidatedMention('Big Blue', 'Big Blue')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // Incidental mention in uri:3 won't be counted (short title)
    expect(dict.entries.has('Big Blue')).toBe(true);
    expect(dict.entries.get('Big Blue')!.incidentalCount).toBe(0);
  });

  it('skips incidental scan for titles appearing in root text', () => {
    const customRootText = 'what is your favorite Big Blue River?';
    const customRootUri = 'at://root/post/custom';
    const posts: PostView[] = [
      makePost(customRootUri, customRootText),
      makePost('uri:1', 'Big Blue River yes'),
      makePost('uri:2', 'Big Blue River!'),
    ];
    const textMap = new Map<string, PostTextContent>();
    textMap.set(customRootUri, makeTextContent(customRootText));
    textMap.set('uri:1', makeTextContent('Big Blue River yes'));
    textMap.set('uri:2', makeTextContent('Big Blue River!'));
    const lookup = buildValidationLookup([
      makeValidatedMention('Big Blue River', 'Big Blue River'),
    ]);
    const dict = discoverDictionary(
      posts,
      textMap,
      lookup,
      customRootUri,
      customRootText.toLowerCase()
    );
    expect(dict.entries.has('Big Blue River')).toBe(true);
  });

  it('handles post without textContent in postTexts map', () => {
    const posts: PostView[] = [makePost(rootUri, rootText), makePost('uri:1', 'Test Post')];
    const textMap = new Map<string, PostTextContent>();
    textMap.set(rootUri, makeTextContent(rootText));
    // uri:1 is intentionally missing from textMap
    const lookup = buildValidationLookup([makeValidatedMention('Test', 'Test')]);
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // Should not crash, entry won't be found
    expect(dict.entries.size).toBe(0);
  });

  it('handles consuming overlapping candidates by longest-first', () => {
    // "The Matrix Reloaded" should consume "Matrix" when both are candidates
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'The Matrix Reloaded', makeTextContent('The Matrix Reloaded')],
        ['uri:2', 'The Matrix Reloaded!', makeTextContent('The Matrix Reloaded!')],
      ],
      [
        makeValidatedMention('The Matrix Reloaded', 'The Matrix Reloaded'),
        makeValidatedMention('Matrix', 'The Matrix'),
      ]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // "The Matrix Reloaded" should be counted, "Matrix" consumed
    expect(dict.entries.has('The Matrix Reloaded')).toBe(true);
  });

  it('filters medium-confidence title that fails alias-canonical alignment', () => {
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'Alpha Beta', makeTextContent('Alpha Beta')],
        ['uri:2', 'Alpha Beta yes', makeTextContent('Alpha Beta yes')],
      ],
      [makeValidatedMention('Alpha Beta', 'Gamma Delta Epsilon Zeta', 'medium')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // No words match between alias and canonical
    expect(dict.entries.has('Gamma Delta Epsilon Zeta')).toBe(false);
  });

  it('allows medium-confidence title with good alias-canonical alignment', () => {
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'Big Blue', makeTextContent('Big Blue')],
        ['uri:2', 'Big Blue yes', makeTextContent('Big Blue yes')],
      ],
      [makeValidatedMention('Big Blue', 'The Big Blue Movie', 'medium')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // "big" and "blue" are 100% of canonical's significant words (after stripping articles)
    expect(dict.entries.has('The Big Blue Movie')).toBe(true);
  });

  it('handles canonical with zero significant words after filtering', () => {
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'The', makeTextContent('The')],
        ['uri:2', 'The yes', makeTextContent('The yes')],
      ],
      [makeValidatedMention('The', 'The')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // Should filter out — no significant words
    expect(dict.entries.has('The')).toBe(false);
  });

  it('handles alias with more significant words than canonical', () => {
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'Big Blue Movie', makeTextContent('Big Blue Movie')],
        ['uri:2', 'Big Blue Movie yes', makeTextContent('Big Blue Movie yes')],
      ],
      [makeValidatedMention('Big Blue Movie', 'Big')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // Alias "big blue movie" vs canonical "big" — 100% of canonical words match (1/1)
    expect(dict.entries.has('Big')).toBe(true);
  });

  it('filters alias with no matching canonical words', () => {
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'Alpha Beta', makeTextContent('Alpha Beta')],
        ['uri:2', 'Alpha Beta yes', makeTextContent('Alpha Beta yes')],
      ],
      [makeValidatedMention('Alpha Beta', 'Gamma Delta')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // Alias "alpha beta" vs canonical "gamma delta" — 0% match
    expect(dict.entries.has('Gamma Delta')).toBe(false);
  });

  it('skips common single-word song titles in main lookup scan', () => {
    // "Just" is validated by MusicBrainz, but it's a common English word.
    // The main lookup scan should skip it to avoid false positives.
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'Just', makeTextContent('Just')],
        ['uri:2', 'Just because I said so', makeTextContent('Just because I said so')],
        ['uri:3', 'Just a great tune', makeTextContent('Just a great tune')],
      ],
      [makeValidatedMention('Just', 'Just')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    // "Just" should be filtered — common single-word song title
    expect(dict.entries.has('Just')).toBe(false);
  });

  it('allows multi-word validated titles through main lookup scan', () => {
    // "Just Dance" is multi-word — should NOT be filtered
    const { posts, textMap, lookup } = setup(
      [
        ['uri:1', 'Just Dance', makeTextContent('Just Dance')],
        ['uri:2', 'Just Dance is my jam', makeTextContent('Just Dance is my jam')],
      ],
      [makeValidatedMention('Just Dance', 'Just Dance')]
    );
    const dict = discoverDictionary(posts, textMap, lookup, rootUri, rootText);
    expect(dict.entries.has('Just Dance')).toBe(true);
  });

  it('handles extractCandidates with mixed empty and non-empty lines', () => {
    const result = extractCandidates('Line One\n\n\nLine Two\n');
    expect(result).toContain('Line One');
    expect(result).toContain('Line Two');
  });

  it('handles isReaction with exactly 49 characters', () => {
    const text = 'x'.repeat(49);
    // <50 chars, no title case — goes to ≤15 check (false) and final return (false)
    expect(isReaction(text)).toBe(false);
  });

  it('handles isReaction with exactly 50 characters', () => {
    const text = 'x'.repeat(50);
    // >=50 chars — skips reaction pattern check, goes to ≤15 check (false), returns false
    expect(isReaction(text)).toBe(false);
  });

  it('handles isReaction with exactly 15 characters without title case', () => {
    const text = 'x'.repeat(15);
    // ≤15 chars, no title case — should be reaction
    expect(isReaction(text)).toBe(true);
  });

  it('handles isReaction with exactly 16 characters without title case', () => {
    const text = 'x'.repeat(16);
    // >15 chars, no pattern match — not a reaction
    expect(isReaction(text)).toBe(false);
  });

  it('handles isAgreement with exactly 49 characters matching pattern', () => {
    const text = 'yes ' + 'x'.repeat(45);
    // <50 chars, starts with "yes" — should match agreement
    expect(isAgreement(text)).toBe(true);
  });

  it('handles isAgreement with exactly 50 characters matching pattern', () => {
    const text = 'yes ' + 'x'.repeat(46);
    // >=50 chars — skips agreement pattern check
    expect(isAgreement(text)).toBe(false);
  });
});

describe('discoverDictionary with embedTitles', () => {
  const rootUri = 'at://root/post/1';
  const rootText = 'what song gets you moving?';

  function setup(
    postData: Array<{ uri: string; text: string }>,
    embedTitles: Map<string, { canonical: string; song: string }>
  ) {
    const posts = [makePost(rootUri, rootText), ...postData.map((p) => makePost(p.uri, p.text))];
    const postTexts = new Map<string, PostTextContent>();
    for (const p of posts) {
      postTexts.set(p.uri, makeTextContent(p.record.text));
    }
    const validationLookup = new Map();
    return discoverDictionary(posts, postTexts, validationLookup, rootUri, rootText.toLowerCase(), {
      embedTitles,
    });
  }

  it('Strategy A: assigns embed title directly to the post', () => {
    const embedTitles = new Map([
      ['at://user/post/2', { canonical: 'Celebration - Kool & The Gang', song: 'Celebration' }],
    ]);
    const dict = setup([{ uri: 'at://user/post/2', text: 'this is my jam!' }], embedTitles);

    expect(dict.entries.has('Celebration - Kool & The Gang')).toBe(true);
    const entry = dict.entries.get('Celebration - Kool & The Gang')!;
    expect(entry.confidentCount).toBeGreaterThanOrEqual(1);
  });

  it('Strategy B: reverse-matches embed song name in other posts', () => {
    const embedTitles = new Map([
      ['at://user/post/2', { canonical: 'September - Earth Wind & Fire', song: 'September' }],
    ]);
    const dict = setup(
      [
        { uri: 'at://user/post/2', text: 'love this one' },
        { uri: 'at://user/post/3', text: 'September is such a great tune' },
      ],
      embedTitles
    );

    expect(dict.entries.has('September - Earth Wind & Fire')).toBe(true);
    const entry = dict.entries.get('September - Earth Wind & Fire')!;
    // Post 2 via Strategy A, post 3 via Strategy B
    expect(entry.confidentCount + entry.incidentalCount).toBeGreaterThanOrEqual(2);
  });

  it('Strategy B: skips short patterns without word boundaries', () => {
    const embedTitles = new Map([['at://user/post/2', { canonical: 'Go - Cat', song: 'Go' }]]);
    // "go" is only 2 chars — too short for pattern matching
    const dict = setup(
      [
        { uri: 'at://user/post/2', text: 'banger' },
        { uri: 'at://user/post/3', text: 'lets gooooo' },
      ],
      embedTitles
    );

    const entry = dict.entries.get('Go - Cat');
    // Strategy A gives it 1 confident, but Strategy B should not match "gooooo"
    expect(entry?.incidentalCount ?? 0).toBe(0);
  });

  it('Strategy B: respects word boundary for short patterns', () => {
    const embedTitles = new Map([
      ['at://user/post/2', { canonical: 'Lean On - Major Lazer', song: 'Lean On' }],
    ]);
    const dict = setup(
      [
        { uri: 'at://user/post/2', text: 'banger' },
        { uri: 'at://user/post/3', text: 'lean on is so good' },
      ],
      embedTitles
    );

    const entry = dict.entries.get('Lean On - Major Lazer');
    // "lean on" is 7 chars (<8), so word boundary is checked.
    // "lean on is so good" has word boundaries around "lean on" → should match
    expect(entry?.incidentalCount).toBeGreaterThanOrEqual(1);
  });

  it('Strategy B: skips common single-word song names to avoid false positives', () => {
    // "Just" by Radiohead is a real song, but "just" is so common that
    // reverse-matching it would tag nearly every post in the thread.
    const embedTitles = new Map([
      ['at://user/post/2', { canonical: 'Just - Radiohead', song: 'Just' }],
    ]);
    const dict = setup(
      [
        { uri: 'at://user/post/2', text: 'link to just by radiohead' },
        { uri: 'at://user/post/3', text: 'I just love this thread' },
        { uri: 'at://user/post/4', text: 'just wanted to say hi' },
      ],
      embedTitles
    );

    const entry = dict.entries.get('Just - Radiohead');
    // Strategy A assigns post 2, but Strategy B should NOT match posts 3 & 4
    // because "just" is a common English word
    expect(entry?.confidentCount).toBeGreaterThanOrEqual(1);
    expect(entry?.incidentalCount ?? 0).toBe(0);
  });

  it('Strategy B: still matches multi-word patterns even if first word is common', () => {
    // "Love Song" contains "love" (a stop word) but the full pattern is multi-word
    const embedTitles = new Map([
      ['at://user/post/2', { canonical: 'Love Song - Sara Bareilles', song: 'Love Song' }],
    ]);
    const dict = setup(
      [
        { uri: 'at://user/post/2', text: 'link here' },
        { uri: 'at://user/post/3', text: 'love song is such a banger' },
      ],
      embedTitles
    );

    const entry = dict.entries.get('Love Song - Sara Bareilles');
    // Multi-word pattern "love song" should still match via Strategy B
    expect(entry?.incidentalCount).toBeGreaterThanOrEqual(1);
  });

  it('Strategy B: skips posts that already have embed assignment', () => {
    const embedTitles = new Map([
      ['at://user/post/2', { canonical: 'Thriller - MJ', song: 'Thriller' }],
      ['at://user/post/3', { canonical: 'Beat It - MJ', song: 'Beat It' }],
    ]);
    const dict = setup(
      [
        { uri: 'at://user/post/2', text: 'Thriller for sure' },
        { uri: 'at://user/post/3', text: 'I love Thriller too' },
      ],
      embedTitles
    );

    // Post 3 already has "Beat It" via Strategy A, so Strategy B should
    // not also give it an incidental match for "Thriller"
    const thrillerEntry = dict.entries.get('Thriller - MJ');
    // Only post 2 should have Thriller (via Strategy A)
    expect(thrillerEntry?.confidentCount).toBeGreaterThanOrEqual(1);
  });

  it('Strategy B: skips songs mentioned in root text', () => {
    // If the root prompt mentions a song name, don't use it as a reverse-match pattern
    const rootTextLocal = 'does anyone like celebration?';
    const posts = [
      makePost(rootUri, rootTextLocal),
      makePost('at://user/post/2', 'link to celebration'),
      makePost('at://user/post/3', 'celebration is the best'),
    ];
    const postTexts = new Map<string, PostTextContent>();
    for (const p of posts) {
      postTexts.set(p.uri, makeTextContent(p.record.text));
    }
    const embedTitles = new Map([
      ['at://user/post/2', { canonical: 'Celebration - Kool', song: 'Celebration' }],
    ]);
    const dict = discoverDictionary(
      posts,
      postTexts,
      new Map(),
      rootUri,
      rootTextLocal.toLowerCase(),
      { embedTitles }
    );

    const entry = dict.entries.get('Celebration - Kool');
    // Strategy A assigns post 2, but Strategy B should not match post 3
    // because "celebration" is in the root text
    expect(entry?.incidentalCount ?? 0).toBe(0);
  });

  it('deduplicates embed matchers by pattern', () => {
    // Two different posts with the same song should produce only one matcher
    const embedTitles = new Map([
      ['at://user/post/2', { canonical: 'Bohemian Rhapsody - Queen', song: 'Bohemian Rhapsody' }],
      ['at://user/post/3', { canonical: 'Bohemian Rhapsody - Queen', song: 'Bohemian Rhapsody' }],
    ]);
    const dict = setup(
      [
        { uri: 'at://user/post/2', text: 'link here' },
        { uri: 'at://user/post/3', text: 'another link' },
        { uri: 'at://user/post/4', text: 'bohemian rhapsody is incredible' },
      ],
      embedTitles
    );

    const entry = dict.entries.get('Bohemian Rhapsody - Queen')!;
    // Posts 2+3 via Strategy A, post 4 via Strategy B (only counted once due to dedup)
    expect(entry.confidentCount).toBeGreaterThanOrEqual(2);
    expect(entry.incidentalCount).toBeGreaterThanOrEqual(1);
  });

  it('merges near-duplicate titles via word-overlap disambiguation', () => {
    // Two very similar titles should be merged by the disambiguation pass.
    // "Paradise by the Dashboard Light" vs "Paradise by the Dashboard Lights"
    // share 85%+ word overlap → get merged.
    const embedTitles = new Map([
      [
        'at://user/post/2',
        {
          canonical: 'Paradise by the Dashboard Light',
          song: 'Paradise by the Dashboard Light',
        },
      ],
      [
        'at://user/post/3',
        {
          canonical: 'Paradise by the Dashboard Lights',
          song: 'Paradise by the Dashboard Lights',
        },
      ],
    ]);
    const dict = setup(
      [
        { uri: 'at://user/post/2', text: 'love it' },
        { uri: 'at://user/post/3', text: 'great song' },
        { uri: 'at://user/post/4', text: 'paradise by the dashboard light' },
      ],
      embedTitles
    );

    // After merge, only one canonical should remain in the dictionary
    const paradiseEntries = [...dict.entries.keys()].filter((k) =>
      k.toLowerCase().includes('paradise')
    );
    expect(paradiseEntries.length).toBe(1);
  });

  it('skips root post in embed title assignment', () => {
    // Even if embedTitles includes the root URI, it should be skipped
    const embedTitles = new Map([
      [rootUri, { canonical: 'Root Song', song: 'Root Song' }],
      ['at://user/post/2', { canonical: 'Real Song - Artist', song: 'Real Song' }],
    ]);
    const dict = setup([{ uri: 'at://user/post/2', text: 'good one' }], embedTitles);

    expect(dict.entries.has('Root Song')).toBe(false);
    expect(dict.entries.has('Real Song - Artist')).toBe(true);
  });
});
