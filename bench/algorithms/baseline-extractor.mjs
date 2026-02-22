/**
 * Baseline algorithm: wraps the existing MentionExtractor from the main project.
 * This is what we're trying to beat.
 *
 * Since MentionExtractor is TypeScript and compiled into the browser bundle,
 * we reimplement its core logic here in plain JS for benchmarking.
 */

// Title case extraction pattern (from mention-extractor.ts line ~824)
const TITLE_CASE_RE =
  /\b([A-Z][a-z']+(?:(?:\s+|:\s*|-\s*)(?:(?:for|the|and|of|a|an|in|on|at|to|is|&|vs\.?)(?:\s+|:\s*|-\s*))*[A-Z][a-z']+)+)/g;

// All caps extraction (from mention-extractor.ts line ~910)
const ALL_CAPS_RE = /\b([A-Z]{2,}(?:\s+[A-Z]{2,})+)\b/g;

// Quoted text extraction
const QUOTED_RE = /"([^"]+)"/g;

// Common words to filter out of title-case matches
const NOISE_WORDS = new Set([
  'I Am',
  'I Was',
  'I Think',
  'I Love',
  'I Just',
  'I Mean',
  'I Also',
  'Oh My',
  'My Dad',
  'My Father',
  'Not Sure',
  'Also My',
  'So Good',
  'Pretty Good',
  'Just Watched',
  'Looking At',
  'Hard Mode',
  'Dad Movie',
  'Dad Movies',
  'Good Movie',
  'Great Movie',
  'Best Movie',
  'Any Movie',
  'Favorite Movie',
  'This Movie',
  'That Movie',
  'Fun Fact',
  'Pro Tip',
  'Hot Take',
  'Great Answer',
  'Good Call',
  'Same Here',
  'Me Too',
  'Sean Connery', // Actor names, not movie titles
  'Kevin Costner',
  'Clint Eastwood',
  'Tom Hanks',
  'Harrison Ford',
  'Russell Crowe',
  'Steve Martin',
  'Gene Hackman',
  'Robert Redford',
  'Jeff Bridges',
  'Dean Martin',
  'Kevin Kline',
  'Danny Glover',
  'Jeff Goldblum',
  'Brian Dennehy',
  'Linda Hunt',
  'Jimmy Stewart',
  'Alan Ladd',
  'Rutger Hauer',
  'Matthew Broderick',
  'Michael Caine',
  'Peter Cushing',
  'Christopher Lee',
  'Robert Duvall',
  'Tommy Lee Jones',
  'Keira Knightley',
  'Al Pacino',
  'Bernie Mac',
  'George Clooney',
  'John Wayne',
  'Richard Attenborough',
  'Kenneth Branagh',
  'Donald Pleasance',
  'Wilford Brimley',
]);

/**
 * Extract movie title candidates from a post's text.
 * Returns an array of candidate title strings.
 */
export function extractTitles(text) {
  if (!text || text.trim().length === 0) return [];

  const candidates = new Set();

  // Strategy 1: Quoted text (high confidence)
  for (const match of text.matchAll(QUOTED_RE)) {
    const title = match[1].trim();
    if (title.length >= 2 && title.length <= 100) {
      candidates.add(title);
    }
  }

  // Strategy 2: Title case sequences
  for (const match of text.matchAll(TITLE_CASE_RE)) {
    const title = match[1].trim();
    if (!NOISE_WORDS.has(title) && title.length >= 3) {
      candidates.add(title);
    }
  }

  // Strategy 3: All caps sequences
  for (const match of text.matchAll(ALL_CAPS_RE)) {
    const raw = match[1].trim();
    if (raw.length >= 4 && raw !== 'WTAF' && raw !== 'OMFG' && raw !== 'LMAO' && raw !== 'LMBO') {
      // Convert to title case
      const title = raw
        .split(/\s+/)
        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
        .join(' ');
      candidates.add(title);
    }
  }

  // Strategy 4: Image alt text (high confidence - often contains exact titles)
  const altMatches = text.matchAll(/\[image alt: ([^\]]+)\]/g);
  for (const match of altMatches) {
    const alt = match[1].trim();
    // Alt text often IS the movie title or contains it prominently
    candidates.add(alt);
  }

  return [...candidates];
}

/**
 * Run baseline extraction on all posts.
 * @param {Array} posts - Array of fixture posts
 * @returns {Map<string, string[]>} - Map of URI -> predicted titles
 */
export function run(posts) {
  const predictions = new Map();

  for (const post of posts) {
    // Use fullText (includes alt text) + quotedText
    let textToSearch = post.fullText || post.text || '';
    if (post.quotedText) {
      textToSearch += '\n' + post.quotedText;
    }

    const titles = extractTitles(textToSearch);
    if (titles.length > 0) {
      predictions.set(post.uri, titles);
    }
  }

  return predictions;
}
