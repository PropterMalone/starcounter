/**
 * Music Extractor algorithm: URL title cache + reverse-match + music-specific regex.
 *
 * Designed for music threads where:
 * - Titles are often lowercase ("fdt", "yub nub")
 * - URL embeds (YouTube/Spotify links) are the strongest signal
 * - Short answers and expletive-laden titles are common
 *
 * Three phases:
 * 1. Build dictionary from URL title cache (resolved YouTube/Spotify/Apple Music titles)
 * 2. Per-post extraction: direct URL hit → dictionary reverse-match → regex fallback
 * 3. Context inheritance for reaction/agreement posts
 *
 * Usage:
 *   import { create } from './algorithms/music-extractor.mjs';
 *   const run = create('bench/fixtures/blast-songs-url-titles.json');
 *   const predictions = run(posts);
 */

import { readFileSync, existsSync } from 'fs';

// ---------------------------------------------------------------------------
// Song title cleanup
// ---------------------------------------------------------------------------

/** Strip YouTube/Spotify/Apple Music metadata from parsed song titles. */
function cleanSongTitle(title) {
  return title
    // Parenthetical video metadata (preserve year parentheticals like "(1978)")
    .replace(
      /\s*\((Official\s*(Music\s*)?Video|Official\s*Audio|Audio|Lyric\s*Video|Lyrics?|Visualizer|Performance\s*Video|Full\s*Album|Animated\s*Video|Music\s*Video)\)/gi,
      '',
    )
    .replace(
      /\s*\[(Official\s*(Music\s*)?Video|Official\s*Audio|Audio|Lyric\s*Video|Lyrics?|Visualizer)\]/gi,
      '',
    )
    // Trailing metadata markers
    .replace(/\s*[/]{1,2}\s*Lyrics?$/i, '')
    .replace(/\s*-\s*Lyrics?$/i, '')
    // Remaster metadata
    .replace(/\s*\(\d+p\s+Remaster[^)]*\)/gi, '')
    .replace(/\s*\(Remastered(\s*\d*)?\)/gi, '')
    .replace(/\s*\[Remastered(\s*\d*)?\]/gi, '')
    // Apple Music suffixes
    .replace(/\s+on\s+Apple\s+Music$/i, '')
    // Surrounding quotes
    .replace(/^["""\u201c\u201d]+|["""\u201c\u201d]+$/g, '')
    .trim();
}

/** Reject entries that are clearly not real song titles. */
function isGarbageTitle(title) {
  if (title.length > 80) return true;
  if (title.split(/\s+/).length > 12) return true;
  // GIF/image descriptions
  if (/^a\s+(person|man|woman|group|cat|dog|gif|clip)/i.test(title)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Phase 1: Build Thread Dictionary from URL Titles
// ---------------------------------------------------------------------------

function buildDictionary(urlTitles) {
  // songMap: dedup key → { canonical, patterns: Set<string> }
  const songMap = new Map();
  // uriToCanonical: post URI → canonical song string (for Strategy A)
  const uriToCanonical = new Map();

  for (const [uri, entry] of Object.entries(urlTitles)) {
    let song = entry.parsedSong || entry.videoTitle;
    if (!song) continue;

    let artist = entry.parsedArtist || null;
    song = cleanSongTitle(song);

    // Parse "Song by Artist" from song field when artist is missing
    // (common for Apple Music pages, non-YouTube links, lyrics sites)
    if (!artist && song.includes(' by ')) {
      const byMatch = song.match(/^(.+?)\s+by\s+([A-Z].{2,})$/);
      if (byMatch) {
        const potentialSong = byMatch[1]
          .replace(/^["""\u201c\u201d]+|["""\u201c\u201d]+$/g, '')
          .trim();
        const potentialArtist = byMatch[2]
          .replace(/\s+on\s+Apple\s+Music$/i, '')
          .trim();
        if (potentialSong.length >= 2 && potentialArtist.length >= 2) {
          song = potentialSong;
          artist = potentialArtist;
        }
      }
    }

    if (isGarbageTitle(song)) continue;

    // Clean artist
    if (artist) {
      artist = artist.replace(/\s+on\s+Apple\s+Music$/i, '').trim();
    }

    const canonical = artist ? `${song} - ${artist}` : song;
    uriToCanonical.set(uri, canonical);

    // Dedup key: lowercase, strip punctuation (keep & and ')
    const key = song
      .toLowerCase()
      .replace(/[^\w\s&']/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (key.length < 2) continue;

    if (!songMap.has(key)) {
      songMap.set(key, { canonical, patterns: new Set() });
    }

    const info = songMap.get(key);
    info.patterns.add(song.toLowerCase());
    if (key !== song.toLowerCase()) info.patterns.add(key);

    // Upgrade canonical to include artist if a better version is available
    if (artist && !info.canonical.includes(' - ')) {
      info.canonical = canonical;
    }
  }

  // Build matchers sorted by longest pattern descending (longest-match-wins)
  const matchers = [];
  for (const [, info] of songMap) {
    const sorted = [...info.patterns]
      .filter((p) => p.length >= 3)
      .sort((a, b) => b.length - a.length);
    if (sorted.length > 0) {
      matchers.push({ canonical: info.canonical, patterns: sorted });
    }
  }
  matchers.sort((a, b) => b.patterns[0].length - a.patterns[0].length);

  return { matchers, uriToCanonical };
}

// ---------------------------------------------------------------------------
// Phase 2: Music-specific regex extraction (Strategy C fallback)
// ---------------------------------------------------------------------------

const MUSIC_NOISE = new Set([
  'I Am',
  'I Was',
  'I Think',
  'I Love',
  'I Just',
  'I Mean',
  'I Also',
  'Oh My',
  'My Dad',
  'My Mom',
  'Not Sure',
  'Also My',
  'So Good',
  'Pretty Good',
  'Just Watched',
  'Looking At',
  'Good Song',
  'Great Song',
  'Best Song',
  'This Song',
  'That Song',
  'Good Choice',
  'Great Choice',
  'Great Answer',
  'Good Call',
  'Good Pick',
  'Same Here',
  'Me Too',
  'My Wife',
  'My Husband',
  'My Kids',
  'Fun Fact',
  'Pro Tip',
  'Hot Take',
  'It Happens', // blast-songs root prompt phrase
]);

// Title case: two+ capitalized words in sequence
const TITLE_CASE_RE =
  /\b([A-Z][a-z']+(?:(?:\s+|:\s*|-\s*)(?:(?:for|from|with|the|and|of|a|an|in|on|at|to|is|or|not|no|it|its|my|his|her|as|so|but|by|&|vs\.?|v\.?)(?:\s+|:\s*|-\s*))*[A-Z][a-z']+)+)/g;

// Quoted text (straight and curly quotes)
const QUOTED_RE = /["""\u201c]([^"""\u201d]{2,80})["""\u201d]/g;

const QUOTED_NOISE_MUSIC = new Set([
  'song',
  'songs',
  'music',
  'tune',
  'tunes',
  'track',
  'tracks',
  'this one',
  'that one',
  'it happens',
  'the thing',
]);

function extractMusicCandidates(text) {
  if (!text || text.trim().length === 0) return [];
  const candidates = [];

  // Quoted text (highest confidence for regex path)
  for (const match of text.matchAll(QUOTED_RE)) {
    const t = match[1].trim();
    if (t.length >= 2 && t.split(/\s+/).length <= 12) {
      if (!QUOTED_NOISE_MUSIC.has(t.toLowerCase())) {
        if (
          !/^(my |your |i |we |he |she |it |this |that |if |but |when |where |what |why |how )/i.test(
            t,
          )
        ) {
          candidates.push(t);
        }
      }
    }
  }

  // Title case sequences
  for (const match of text.matchAll(TITLE_CASE_RE)) {
    const t = match[1].trim();
    if (!MUSIC_NOISE.has(t) && t.length >= 3) {
      candidates.push(t);
    }
  }

  // Image alt text
  for (const match of text.matchAll(/\[image alt: ([^\]]+)\]/g)) {
    const alt = match[1].trim();
    if (alt.length <= 80 && alt.split(/\s+/).length <= 10) {
      candidates.push(alt);
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Phase 3: Context Inheritance (music-tuned)
// ---------------------------------------------------------------------------

const MUSIC_REACTION_PATTERNS = [
  /^(yes|yep|yeah|yup|agreed|exactly|absolutely|definitely|this|same|correct|100%|💯)/i,
  /^(so good|great|amazing|incredible|love (it|this)|hell yeah|oh hell yeah)/i,
  /^(came here to say this|this is (it|the one|mine)|good (call|choice|pick|answer))/i,
  /^(underrated|overrated|classic|banger|legendary|goat|peak)/i,
  /^(bop|tune|anthem|jam|slaps|bangs|certified|vibes?|mood)/i,
  /^[^\w]*$/, // emoji/punctuation only
  /^(lol|lmao|lmbo|omg|omfg|ha+|😂|🤣|👏|👍|🔥|💯|❤️|🎯|🎶|🎵)+$/i,
  /^me too/i,
  /^right\??!*$/i,
  /^well,?\s*yes/i,
  /^oh (hell|fuck) yes/i,
  /^(yesss+|yasss+)/i,
  /^this is the (answer|one|way)/i,
];

function isMusicReaction(text) {
  const trimmed = (text || '').trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 60) {
    return MUSIC_REACTION_PATTERNS.some((p) => p.test(trimmed));
  }
  if (trimmed.length <= 15 && !/[A-Z][a-z]{2,}/.test(trimmed)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Factory: create(urlTitleCachePath) → run(posts) → Map<string, string[]>
// ---------------------------------------------------------------------------

/**
 * Create a music-extractor algorithm instance for a specific URL title cache.
 * @param {string} urlTitleCachePath - Path to the URL title cache JSON
 * @returns {function(Array): Map<string, string[]>} - run(posts) function
 */
export function create(urlTitleCachePath) {
  let urlTitles = null;
  let matchers = [];
  let uriToCanonical = new Map();

  try {
    if (existsSync(urlTitleCachePath)) {
      const data = JSON.parse(readFileSync(urlTitleCachePath, 'utf-8'));
      urlTitles = data.titles || {};
      const built = buildDictionary(urlTitles);
      matchers = built.matchers;
      uriToCanonical = built.uriToCanonical;
    }
  } catch {
    // Fall through to no-cache mode
  }

  if (!urlTitles || Object.keys(urlTitles).length === 0) {
    return (posts) => {
      console.warn(`  ⚠ No URL title cache at ${urlTitleCachePath}`);
      return new Map();
    };
  }

  console.log(
    `  Music extractor: ${Object.keys(urlTitles).length} URL titles → ${matchers.length} dictionary entries`,
  );

  return function run(posts) {
    const postsByUri = new Map();
    for (const p of posts) postsByUri.set(p.uri, p);
    const rootUri = posts[0]?.uri;
    const rootText = (posts[0]?.text || '').toLowerCase();

    const predictions = new Map();
    let strategyAHits = 0;
    let strategyBHits = 0;
    let strategyCHits = 0;

    // Pass 1: Per-post extraction
    for (const post of posts) {
      if (post.uri === rootUri) continue;

      const ownText = post.fullText || post.text || '';
      let searchText = ownText;
      if (post.quotedText && post.quotedUri !== rootUri) {
        searchText += '\n' + post.quotedText;
      }
      if (post.quotedAltText) {
        searchText += '\n' + post.quotedAltText.join('\n');
      }

      const titles = new Set();

      // Strategy A: Direct URL hit — post's URI is in the URL title cache
      if (uriToCanonical.has(post.uri)) {
        titles.add(uriToCanonical.get(post.uri));
        strategyAHits++;
      }

      // Strategy B: Dictionary reverse-match — scan text for known song titles
      const lowerText = searchText.toLowerCase();
      const consumedRanges = []; // tracks claimed text spans for overlap detection

      for (const { canonical, patterns } of matchers) {
        if (titles.has(canonical)) continue;
        for (const pattern of patterns) {
          if (pattern.length < 4) continue;
          if (rootText.includes(pattern)) continue;

          const idx = lowerText.indexOf(pattern);
          if (idx === -1) continue;

          // Word boundary check for short patterns (< 8 chars)
          if (pattern.length < 8) {
            const before = idx > 0 ? lowerText[idx - 1] : ' ';
            const after =
              idx + pattern.length < lowerText.length
                ? lowerText[idx + pattern.length]
                : ' ';
            if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
          }

          // Overlap check — don't match text already claimed by a longer match
          const start = idx;
          const end = idx + pattern.length;
          const overlaps = consumedRanges.some((r) => start < r.end && end > r.start);
          if (overlaps) continue;

          titles.add(canonical);
          consumedRanges.push({ start, end });
          strategyBHits++;
          break;
        }
      }

      // Strategy C: Music-specific regex (only if A and B found nothing)
      if (titles.size === 0) {
        const candidates = extractMusicCandidates(searchText);
        for (const c of candidates) {
          titles.add(c);
        }

        // Short direct answers: if direct reply to root, ≤60 chars, no URL,
        // treat the cleaned text as a potential song title
        const isDirectReply =
          post.parentUri === rootUri ||
          (post.source === 'quote' && post.depth <= 1) ||
          (post.source === 'quote-reply' && post.depth <= 1);

        if (isDirectReply && titles.size === 0) {
          const cleaned = (post.text || '')
            .replace(/https?:\/\/\S+/g, '')
            .replace(/[#@]\S+/g, '')
            .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
            .replace(/\s+/g, ' ')
            .trim();

          if (
            cleaned.length >= 2 &&
            cleaned.length <= 60 &&
            cleaned.split(/\s+/).length <= 10
          ) {
            if (!isMusicReaction(cleaned)) {
              titles.add(cleaned);
            }
          }
        }

        if (titles.size > 0) strategyCHits++;
      }

      if (titles.size > 0) {
        predictions.set(post.uri, [...titles]);
      }
    }

    // Pass 2: Context inheritance (depth-limited)
    const MAX_DEPTH = 2;

    function getInheritedTitles(uri, depth) {
      if (depth > MAX_DEPTH) return null;
      if (predictions.has(uri)) return predictions.get(uri);
      const post = postsByUri.get(uri);
      if (!post || !post.parentUri) return null;
      return getInheritedTitles(post.parentUri, depth + 1);
    }

    let inheritedCount = 0;
    for (const post of posts) {
      if (predictions.has(post.uri)) continue;
      if (post.uri === rootUri) continue;
      if (!isMusicReaction(post.text) && (post.text || '').length >= 100) continue;

      if (post.parentUri) {
        const inherited = getInheritedTitles(post.parentUri, 1);
        if (inherited && inherited.length > 0) {
          predictions.set(post.uri, inherited);
          inheritedCount++;
        }
      }
    }

    console.log(
      `  Music extractor: ${predictions.size} posts predicted ` +
        `(A:${strategyAHits} B:${strategyBHits} C:${strategyCHits} ctx:${inheritedCount})`,
    );
    return predictions;
  };
}
