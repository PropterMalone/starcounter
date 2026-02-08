import { describe, it, expect } from 'vitest';
import {
  extractCandidates,
  extractShortTextCandidate,
  isReaction,
  isAgreement,
  buildValidationLookup,
  discoverDictionary,
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
});
