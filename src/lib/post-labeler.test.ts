import { describe, it, expect } from 'vitest';
import { labelPosts } from './post-labeler';
import type { PostView } from '../types';
import type { PostTextContent } from './text-extractor';
import type { ThreadDictionary, ValidationLookupEntry } from './thread-dictionary';

const rootUri = 'at://root/post/1';
const rootText = 'what is your favorite dad movie?';

function makePost(uri: string, text: string, parentUri?: string): PostView {
  return {
    uri,
    cid: 'cid-test',
    author: { did: 'did:plc:test', handle: 'test.bsky.social' },
    record: {
      text,
      createdAt: '2024-01-01T00:00:00Z',
      ...(parentUri
        ? {
            reply: {
              root: { uri: rootUri, cid: 'cid-root' },
              parent: { uri: parentUri, cid: 'cid-parent' },
            },
          }
        : {}),
    },
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

function makeDictionary(
  entries: [string, { aliases: string[]; frequency: number }][]
): ThreadDictionary {
  const map = new Map(
    entries.map(([canonical, info]) => [
      canonical,
      {
        canonical,
        aliases: new Set(info.aliases.map((a) => a.toLowerCase())),
        frequency: info.frequency,
        confidence: 'high' as const,
        confidentCount: info.frequency,
        incidentalCount: 0,
        postUris: new Set<string>(),
      },
    ])
  );
  return { entries: map };
}

function makeLookup(entries: [string, string][]): Map<string, ValidationLookupEntry> {
  return new Map(
    entries.map(([candidate, canonical]) => [
      candidate.toLowerCase(),
      { canonical, confidence: 'high' as const },
    ])
  );
}

describe('labelPosts', () => {
  it('labels a post via forward lookup', () => {
    const posts = [makePost(rootUri, rootText), makePost('uri:1', 'Die Hard is the best', rootUri)];
    const textMap = new Map<string, PostTextContent>([
      [rootUri, makeTextContent(rootText)],
      ['uri:1', makeTextContent('Die Hard is the best')],
    ]);
    const dict = makeDictionary([['Die Hard', { aliases: ['die hard'], frequency: 5 }]]);
    const lookup = makeLookup([['Die Hard', 'Die Hard']]);

    const result = labelPosts(posts, textMap, dict, lookup, rootUri, rootText);
    expect(result.get('uri:1')).toEqual(new Set(['Die Hard']));
  });

  it('labels a post via reverse lookup', () => {
    // The text contains a dictionary alias as a substring, not extracted by regex
    const posts = [
      makePost(rootUri, rootText),
      makePost('uri:1', 'i love the hunt for red october', rootUri),
    ];
    const textMap = new Map<string, PostTextContent>([
      [rootUri, makeTextContent(rootText)],
      ['uri:1', makeTextContent('i love the hunt for red october')],
    ]);
    const dict = makeDictionary([
      [
        'The Hunt for Red October',
        { aliases: ['the hunt for red october', 'hunt for red october'], frequency: 3 },
      ],
    ]);
    const lookup = makeLookup([]);

    const result = labelPosts(posts, textMap, dict, lookup, rootUri, rootText);
    expect(result.get('uri:1')).toEqual(new Set(['The Hunt for Red October']));
  });

  it('uses longest-match-wins for forward lookup', () => {
    // Forward lookup: extractCandidates extracts quoted phrases. The longer candidate
    // consumes the shorter one via substring check on consumed candidates.
    // However, in a real pipeline, "The Good" would be removed in dictionary building
    // (Phase 1 dedup) if it only appears alongside the longer title.
    // Here we test that forward lookup correctly finds the longer title.
    const posts = [
      makePost(rootUri, rootText),
      makePost('uri:1', '"The Good the Bad and the Ugly"', rootUri),
    ];
    const textMap = new Map<string, PostTextContent>([
      [rootUri, makeTextContent(rootText)],
      ['uri:1', makeTextContent('"The Good the Bad and the Ugly"')],
    ]);
    // Only include the long title in dictionary — "The Good" would have been
    // deduped in Phase 1 since it only appears with the longer title.
    const dict = makeDictionary([
      [
        'The Good, the Bad and the Ugly',
        { aliases: ['the good the bad and the ugly'], frequency: 3 },
      ],
    ]);
    const lookup = makeLookup([
      ['The Good the Bad and the Ugly', 'The Good, the Bad and the Ugly'],
    ]);

    const result = labelPosts(posts, textMap, dict, lookup, rootUri, rootText);
    const titles = result.get('uri:1');
    expect(titles).toContain('The Good, the Bad and the Ugly');
    expect(titles?.size).toBe(1);
  });

  it('uses longest-match-wins for reverse lookup (character spans)', () => {
    const posts = [
      makePost(rootUri, rootText),
      makePost('uri:1', 'indiana jones and the last crusade', rootUri),
    ];
    const textMap = new Map<string, PostTextContent>([
      [rootUri, makeTextContent(rootText)],
      ['uri:1', makeTextContent('indiana jones and the last crusade')],
    ]);
    const dict = makeDictionary([
      [
        'Indiana Jones and the Last Crusade',
        { aliases: ['indiana jones and the last crusade'], frequency: 3 },
      ],
      ['Indiana Jones', { aliases: ['indiana jones'], frequency: 2 }],
    ]);
    const lookup = makeLookup([]);

    const result = labelPosts(posts, textMap, dict, lookup, rootUri, rootText);
    const titles = result.get('uri:1');
    expect(titles).toContain('Indiana Jones and the Last Crusade');
    // The shorter alias overlaps character span, so it should not also match
    expect(titles).not.toContain('Indiana Jones');
  });

  it('skips root post patterns in reverse lookup', () => {
    // If the root text mentions "movie", reverse lookup should not match it
    const posts = [
      makePost(rootUri, rootText),
      makePost('uri:1', 'what is your favorite dad movie?', rootUri),
    ];
    const textMap = new Map<string, PostTextContent>([
      [rootUri, makeTextContent(rootText)],
      ['uri:1', makeTextContent('what is your favorite dad movie?')],
    ]);
    const dict = makeDictionary([
      ['Dad Movie', { aliases: ['dad movie', 'favorite dad movie'], frequency: 2 }],
    ]);
    const lookup = makeLookup([]);

    const result = labelPosts(posts, textMap, dict, lookup, rootUri, rootText);
    expect(result.has('uri:1')).toBe(false);
  });

  it('inherits context from parent for reaction posts', () => {
    const posts = [
      makePost(rootUri, rootText),
      makePost('uri:1', 'Die Hard is the best', rootUri),
      makePost('uri:2', 'yes absolutely', 'uri:1'),
    ];
    const textMap = new Map<string, PostTextContent>([
      [rootUri, makeTextContent(rootText)],
      ['uri:1', makeTextContent('Die Hard is the best')],
      ['uri:2', makeTextContent('yes absolutely')],
    ]);
    const dict = makeDictionary([['Die Hard', { aliases: ['die hard'], frequency: 5 }]]);
    const lookup = makeLookup([['Die Hard', 'Die Hard']]);

    const result = labelPosts(posts, textMap, dict, lookup, rootUri, rootText);
    expect(result.get('uri:2')).toEqual(new Set(['Die Hard']));
  });

  it('limits inheritance depth to 2', () => {
    // To block inheritance, a post must be non-reaction AND ≥100 chars.
    // We create a chain where 3 posts in a row are ineligible for inheritance
    // (long, non-reaction), so a reaction at the end can't reach any prediction.
    const longText1 =
      'I actually disagree with this take for many reasons. The acting was mediocre, the plot was predictable, and the effects were cheap.';
    const longText2 =
      'Furthermore I think people overlook how problematic the themes are. It promotes violence and glorifies toxic masculinity throughout the film.';
    const longText3 =
      'And the sequel was even worse. The director clearly ran out of ideas. The whole franchise should have ended with the first installment honestly.';
    const posts = [
      makePost(rootUri, rootText),
      makePost('uri:1', 'Die Hard', rootUri),
      // 3 consecutive non-reaction long posts (≥100 chars) — won't inherit
      makePost('uri:gap1', longText1, 'uri:1'),
      makePost('uri:gap2', longText2, 'uri:gap1'),
      makePost('uri:gap3', longText3, 'uri:gap2'),
      // uri:5 is a reaction, but its parent chain of 3 non-inheriting posts
      // means getInheritedTitles must recurse 3 levels to find uri:1
      makePost('uri:5', 'agreed', 'uri:gap3'),
    ];
    const textMap = new Map<string, PostTextContent>([
      [rootUri, makeTextContent(rootText)],
      ['uri:1', makeTextContent('Die Hard')],
      ['uri:gap1', makeTextContent(longText1)],
      ['uri:gap2', makeTextContent(longText2)],
      ['uri:gap3', makeTextContent(longText3)],
      ['uri:5', makeTextContent('agreed')],
    ]);
    const dict = makeDictionary([['Die Hard', { aliases: ['die hard'], frequency: 5 }]]);
    const lookup = makeLookup([['Die Hard', 'Die Hard']]);

    const result = labelPosts(posts, textMap, dict, lookup, rootUri, rootText);
    // uri:gap1/2/3 are non-reaction long posts → don't inherit
    expect(result.has('uri:gap1')).toBe(false);
    expect(result.has('uri:gap2')).toBe(false);
    expect(result.has('uri:gap3')).toBe(false);
    // uri:5: getInheritedTitles(uri:gap3, 1) → no prediction → recurse(uri:gap2, 2) → no → recurse(uri:gap1, 3) → depth 3 > MAX_DEPTH → null
    expect(result.has('uri:5')).toBe(false);
  });

  it('does not inherit for non-reaction long posts', () => {
    const posts = [
      makePost(rootUri, rootText),
      makePost('uri:1', 'Die Hard is the best', rootUri),
      makePost(
        'uri:2',
        'I actually disagree, I think there are much better movies. The action was good but the plot was mediocre at best. Not my cup of tea.',
        'uri:1'
      ),
    ];
    const textMap = new Map<string, PostTextContent>([
      [rootUri, makeTextContent(rootText)],
      ['uri:1', makeTextContent('Die Hard is the best')],
      [
        'uri:2',
        makeTextContent(
          'I actually disagree, I think there are much better movies. The action was good but the plot was mediocre at best. Not my cup of tea.'
        ),
      ],
    ]);
    const dict = makeDictionary([['Die Hard', { aliases: ['die hard'], frequency: 5 }]]);
    const lookup = makeLookup([['Die Hard', 'Die Hard']]);

    const result = labelPosts(posts, textMap, dict, lookup, rootUri, rootText);
    // Long non-reaction post should not inherit
    expect(result.has('uri:2')).toBe(false);
  });

  it('labels multiple titles in a single post', () => {
    const posts = [
      makePost(rootUri, rootText),
      makePost('uri:1', 'Die Hard and The Matrix are both great', rootUri),
    ];
    const textMap = new Map<string, PostTextContent>([
      [rootUri, makeTextContent(rootText)],
      ['uri:1', makeTextContent('Die Hard and The Matrix are both great')],
    ]);
    const dict = makeDictionary([
      ['Die Hard', { aliases: ['die hard'], frequency: 5 }],
      ['The Matrix', { aliases: ['the matrix'], frequency: 4 }],
    ]);
    const lookup = makeLookup([
      ['Die Hard', 'Die Hard'],
      ['The Matrix', 'The Matrix'],
    ]);

    const result = labelPosts(posts, textMap, dict, lookup, rootUri, rootText);
    const titles = result.get('uri:1');
    expect(titles).toContain('Die Hard');
    expect(titles).toContain('The Matrix');
  });

  it('uses quoted text for labeling', () => {
    const posts = [makePost(rootUri, rootText), makePost('uri:1', 'This one!', rootUri)];
    const textMap = new Map<string, PostTextContent>([
      [rootUri, makeTextContent(rootText)],
      [
        'uri:1',
        makeTextContent('This one!', {
          quotedText: 'Die Hard is the best',
          quotedUri: 'uri:other',
          searchText: 'This one!\nDie Hard is the best',
        }),
      ],
    ]);
    const dict = makeDictionary([['Die Hard', { aliases: ['die hard'], frequency: 5 }]]);
    const lookup = makeLookup([['Die Hard', 'Die Hard']]);

    const result = labelPosts(posts, textMap, dict, lookup, rootUri, rootText);
    expect(result.get('uri:1')).toEqual(new Set(['Die Hard']));
  });
});
