import { describe, it, expect } from 'vitest';
import {
  extractCategoryWords,
  buildSelfValidatedLookup,
  buildListValidatedLookup,
} from './self-validation';

// ---------------------------------------------------------------------------
// extractCategoryWords
// ---------------------------------------------------------------------------

describe('extractCategoryWords', () => {
  it('extracts single noun from "your home river"', () => {
    expect(extractCategoryWords('what is your home river?')).toEqual(['river']);
  });

  it('extracts multi-word noun from "your favorite board game"', () => {
    expect(extractCategoryWords('share your favorite board game')).toEqual(['board', 'game']);
  });

  it('extracts noun after compound adjective "go-to comfort food"', () => {
    expect(extractCategoryWords("what's your go-to comfort food?")).toEqual(['comfort', 'food']);
  });

  it('handles "all-time" adjective', () => {
    expect(extractCategoryWords('what is your all-time favorite song?')).toEqual(['song']);
  });

  it('returns empty array when no "your" pattern found', () => {
    expect(extractCategoryWords('hello world')).toEqual([]);
  });

  it('returns empty array for generic prompts without nouns after "your"', () => {
    expect(extractCategoryWords('share your favorite')).toEqual([]);
  });

  it('handles prompts without question mark', () => {
    expect(extractCategoryWords('tell us your childhood cartoon')).toEqual(['cartoon']);
  });

  it('stops at function words in complex sentences', () => {
    const text =
      'My favorite Twitter prompt was "RT this with your home river," so reskeet this with your home river.';
    expect(extractCategoryWords(text)).toEqual(['river']);
  });

  it('stops at function words even without punctuation', () => {
    const text = 'reskeet this with your home river so we can see them all';
    expect(extractCategoryWords(text)).toEqual(['river']);
  });

  it('limits to 3 category words max', () => {
    const text = 'what is your favorite video game console brand name';
    const result = extractCategoryWords(text);
    expect(result.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// buildSelfValidatedLookup
// ---------------------------------------------------------------------------

describe('buildSelfValidatedLookup', () => {
  it('clusters variants of the same answer', () => {
    const candidates = new Set(['The Nile', 'the nile', 'Nile']);
    const lookup = buildSelfValidatedLookup(candidates, 'what is your home river?');

    // All three should resolve to the same canonical
    const canonicals = new Set([...lookup.values()].map((v) => v.canonical));
    expect(canonicals.size).toBe(1);
    expect(lookup.get('the nile')?.canonical).toBe(lookup.get('nile')?.canonical);
  });

  it('strips leading articles for normalization', () => {
    const candidates = new Set(['The Mississippi', 'A Mississippi', 'Mississippi']);
    const lookup = buildSelfValidatedLookup(candidates, 'what is your home river?');

    // All should map to same canonical
    expect(lookup.get('the mississippi')?.canonical).toBe('Mississippi');
    expect(lookup.get('a mississippi')?.canonical).toBe('Mississippi');
    expect(lookup.get('mississippi')?.canonical).toBe('Mississippi');
  });

  it('preserves category words in normalization (does not strip)', () => {
    const candidates = new Set(['Mississippi River', 'Mississippi']);
    const lookup = buildSelfValidatedLookup(candidates, 'what is your home river?');

    expect(lookup.get('mississippi river')?.canonical).toBe('Mississippi River');
    expect(lookup.get('mississippi')?.canonical).toBe('Mississippi');
  });

  it('preserves plural category words in normalization', () => {
    const candidates = new Set(['Monopoly', 'Monopoly games']);
    const lookup = buildSelfValidatedLookup(candidates, 'what is your favorite board game?');

    expect(lookup.get('monopoly')?.canonical).toBe('Monopoly');
    expect(lookup.get('monopoly games')?.canonical).toBe('Monopoly Games');
  });

  it('filters candidates with more than 5 words', () => {
    const candidates = new Set(['Nile', 'the one near my house by the bridge over there']);
    const lookup = buildSelfValidatedLookup(candidates, 'what is your home river?');

    expect(lookup.has('nile')).toBe(true);
    expect(lookup.has('the one near my house by the bridge over there')).toBe(false);
  });

  it('picks most common surface form as canonical (tie-break: shortest)', () => {
    const candidates = new Set(['Amazon', 'amazon', 'The Amazon']);
    const lookup = buildSelfValidatedLookup(candidates, 'what is your home river?');

    // "Amazon" appears twice after article stripping (both "Amazon" and "amazon" → "Amazon",
    // "The Amazon" → "Amazon"), so canonical should be "Amazon"
    expect(lookup.get('amazon')?.canonical).toBe('Amazon');
  });

  it('title-cases the canonical', () => {
    const candidates = new Set(['blue danube']);
    const lookup = buildSelfValidatedLookup(candidates, 'what is your home river?');

    expect(lookup.get('blue danube')?.canonical).toBe('Blue Danube');
  });

  it('all entries have high confidence', () => {
    const candidates = new Set(['Nile', 'Amazon']);
    const lookup = buildSelfValidatedLookup(candidates, 'what is your home river?');

    for (const entry of lookup.values()) {
      expect(entry.confidence).toBe('high');
    }
  });

  it('handles empty candidate set', () => {
    const lookup = buildSelfValidatedLookup(new Set(), 'what is your home river?');
    expect(lookup.size).toBe(0);
  });

  it('handles root text with no category words', () => {
    const candidates = new Set(['Pizza', 'Sushi']);
    const lookup = buildSelfValidatedLookup(candidates, 'hello world');

    // Should still work — just no category stripping
    expect(lookup.get('pizza')?.canonical).toBe('Pizza');
    expect(lookup.get('sushi')?.canonical).toBe('Sushi');
  });

  it('filters candidates whose normKey is < 3 characters', () => {
    const candidates = new Set(['Go', 'Mississippi']);
    const lookup = buildSelfValidatedLookup(candidates, 'what is your home river?');

    expect(lookup.has('go')).toBe(false);
    expect(lookup.has('mississippi')).toBe(true);
  });

  it('filters candidates that are just the category word', () => {
    const candidates = new Set(['River', 'Mississippi']);
    const lookup = buildSelfValidatedLookup(candidates, 'what is your home river?');

    expect(lookup.has('river')).toBe(false);
    expect(lookup.has('mississippi')).toBe(true);
  });

  it('filters plural forms of category words', () => {
    const candidates = new Set(['Games', 'Monopoly']);
    const lookup = buildSelfValidatedLookup(candidates, 'what is your favorite game?');

    expect(lookup.has('games')).toBe(false);
    expect(lookup.has('monopoly')).toBe(true);
  });

  it('filters common stop words like "here", "what", "then"', () => {
    const candidates = new Set(['Here', 'What', 'Then', 'Mississippi']);
    const lookup = buildSelfValidatedLookup(candidates, 'what is your home river?');

    expect(lookup.has('here')).toBe(false);
    expect(lookup.has('what')).toBe(false);
    expect(lookup.has('then')).toBe(false);
    expect(lookup.has('mississippi')).toBe(true);
  });

  it('filters normKeys composed entirely of function/stop words', () => {
    // "My Home River" → "my home river" — my=function, home=adjective, river=category → all filtered
    const candidates = new Set(['My Home River', 'Nile']);
    const lookup = buildSelfValidatedLookup(candidates, 'what is your home river?');

    expect(lookup.has('my home river')).toBe(false);
    expect(lookup.has('nile')).toBe(true);
  });

  it('filters phrases composed entirely of stop words and category words', () => {
    const candidates = new Set(['Best River', 'Home River', 'Mississippi River']);
    const lookup = buildSelfValidatedLookup(candidates, 'what is your home river?');

    expect(lookup.has('best river')).toBe(false);
    expect(lookup.has('home river')).toBe(false);
    expect(lookup.has('mississippi river')).toBe(true);
  });

  it('keeps legitimate short normKeys >= 3 chars', () => {
    const candidates = new Set(['Dee', 'Wye', 'Exe']);
    const lookup = buildSelfValidatedLookup(candidates, 'what is your home river?');

    expect(lookup.has('dee')).toBe(true);
    expect(lookup.has('wye')).toBe(true);
    expect(lookup.has('exe')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildListValidatedLookup
// ---------------------------------------------------------------------------

describe('buildListValidatedLookup', () => {
  it('matches candidate to list item (exact)', () => {
    const candidates = new Set(['Nile']);
    const list = ['Nile', 'Amazon', 'Mississippi'];
    const lookup = buildListValidatedLookup(candidates, list);

    expect(lookup.get('nile')).toEqual({ canonical: 'Nile', confidence: 'high' });
  });

  it('matches with article stripping', () => {
    const candidates = new Set(['The Nile']);
    const list = ['Nile'];
    const lookup = buildListValidatedLookup(candidates, list);

    expect(lookup.get('the nile')?.canonical).toBe('Nile');
  });

  it('matches when list item contains candidate', () => {
    const candidates = new Set(['Amazon']);
    const list = ['Amazon River'];
    const lookup = buildListValidatedLookup(candidates, list);

    expect(lookup.get('amazon')?.canonical).toBe('Amazon River');
  });

  it('matches when candidate contains list item', () => {
    const candidates = new Set(['Mississippi River']);
    const list = ['Mississippi'];
    const lookup = buildListValidatedLookup(candidates, list);

    expect(lookup.get('mississippi river')?.canonical).toBe('Mississippi');
  });

  it('preserves user casing from list', () => {
    const candidates = new Set(['NILE']);
    const list = ['River Nile'];
    const lookup = buildListValidatedLookup(candidates, list);

    expect(lookup.get('nile')?.canonical).toBe('River Nile');
  });

  it('excludes candidates that match no list item', () => {
    const candidates = new Set(['Nile', 'Styx']);
    const list = ['Nile', 'Amazon'];
    const lookup = buildListValidatedLookup(candidates, list);

    expect(lookup.has('nile')).toBe(true);
    expect(lookup.has('styx')).toBe(false);
  });

  it('handles empty list', () => {
    const candidates = new Set(['Nile']);
    const lookup = buildListValidatedLookup(candidates, []);
    expect(lookup.size).toBe(0);
  });

  it('handles empty candidates', () => {
    const lookup = buildListValidatedLookup(new Set(), ['Nile']);
    expect(lookup.size).toBe(0);
  });

  it('strips trailing punctuation from list items', () => {
    const candidates = new Set(['Nile']);
    const list = ['Nile.', 'Amazon!'];
    const lookup = buildListValidatedLookup(candidates, list);

    expect(lookup.get('nile')?.canonical).toBe('Nile.');
  });
});
