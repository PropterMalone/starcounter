// pattern: Imperative Shell
import type { MediaType } from '../../src/lib/mention-extractor';

type TMDBResult = {
  readonly id?: number;
  readonly title?: string;
  readonly name?: string;
  readonly release_date?: string;
  readonly first_air_date?: string;
  readonly vote_average?: number;
  readonly vote_count?: number;
  readonly popularity?: number;
};

type MusicBrainzResult = {
  readonly id?: string;
  readonly title?: string;
  readonly score?: number;
  readonly 'artist-credit'?: Array<{ readonly name: string }>;
};

type CloudflareEnv = {
  readonly TMDB_API_KEY: string;
  readonly MUSICBRAINZ_USER_AGENT: string;
  readonly VALIDATION_CACHE?: KVNamespace;
};

export type ValidationOptions = {
  readonly tmdbApiKey: string;
  readonly musicbrainzUserAgent: string;
  readonly cache?: KVNamespace; // Cloudflare KV for caching
};

export type ValidationResult = {
  readonly title: string;
  readonly validated: boolean;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly source?: 'tmdb' | 'musicbrainz';
  readonly artist?: string; // For music
  readonly metadata?: {
    readonly id?: string | number;
    readonly releaseDate?: string;
    readonly voteAverage?: number;
    readonly popularity?: number;
  };
  readonly error?: string;
};

const CACHE_TTL = 60 * 60 * 24; // 24 hours - shorter to pick up scoring improvements faster
const CACHE_VERSION = 'v4'; // Increment to invalidate stale entries after scoring changes

/**
 * Safely read from KV cache, returning null on any error
 */
async function safeKVGet(cache: KVNamespace, key: string): Promise<ValidationResult | null> {
  try {
    return await cache.get(key, 'json');
  } catch {
    // KV read failed (quota, network, etc.) - continue without cache
    return null;
  }
}

/**
 * Safely write to KV cache, silently ignoring errors (e.g., quota exceeded)
 */
async function safeKVPut(cache: KVNamespace, key: string, value: string, ttl: number): Promise<void> {
  try {
    await cache.put(key, value, { expirationTtl: ttl });
  } catch (error) {
    // KV write failed (likely quota exceeded on free tier: 1000 puts/day)
    // Log but continue - caching is an optimization, not a requirement
    console.warn(`KV cache write failed for key "${key}":`, error instanceof Error ? error.message : error);
  }
}

/**
 * Validate a mention against external APIs
 */
export async function validateMention(
  title: string,
  mediaType: MediaType,
  options: ValidationOptions
): Promise<ValidationResult> {
  const cacheKey = `${CACHE_VERSION}:${mediaType}:${title.toLowerCase()}`;

  // Check cache (with graceful fallback on error)
  if (options.cache) {
    const cached = await safeKVGet(options.cache, cacheKey);
    if (cached) {
      return cached;
    }
  }

  let result: ValidationResult;

  try {
    if (mediaType === 'MOVIE' || mediaType === 'TV_SHOW' || mediaType === 'UNKNOWN') {
      // For UNKNOWN, default to movie search since this is primarily a movie analyzer
      result = await validateTMDB(title, mediaType === 'UNKNOWN' ? 'MOVIE' : mediaType, options.tmdbApiKey);
    } else if (mediaType === 'MUSIC') {
      result = await validateMusicBrainz(title, options.musicbrainzUserAgent);
    } else {
      result = {
        title,
        validated: false,
        confidence: 'low',
        error: 'Unknown media type',
      };
    }
  } catch (error) {
    result = {
      title,
      validated: false,
      confidence: 'low',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Cache result (with graceful fallback on quota exceeded)
  if (options.cache) {
    await safeKVPut(options.cache, cacheKey, JSON.stringify(result), CACHE_TTL);
  }

  return result;
}

// Common words that shouldn't be movie titles on their own
const GENERIC_WORDS = new Set([
  'good', 'great', 'bad', 'best', 'worst', 'nice', 'cool', 'awesome',
  'night', 'day', 'morning', 'evening', 'today', 'yesterday', 'tomorrow',
  'still', 'stuff', 'thing', 'things', 'every', 'which', 'what', 'where', 'when', 'who', 'how',
  'father', 'mother', 'brother', 'sister', 'son', 'daughter', 'dad', 'mom',
  'hunt', 'master', 'commander', 'bride', 'last', 'first', 'field', 'dreams',
  'movie', 'film', 'show', 'watch', 'watching', 'watched', 'seen', 'see',
  'love', 'like', 'hate', 'want', 'need', 'think', 'know', 'feel',
  'time', 'year', 'years', 'old', 'new', 'big', 'small', 'long', 'short',
  'man', 'woman', 'people', 'person', 'life', 'world', 'way', 'part',
  'just', 'really', 'actually', 'probably', 'maybe', 'always', 'never',
  'dad movie', 'mom movie', 'classic', 'favorite', 'favourite',
  'ocean', 'oceans', // Often false positive from "Ocean's Eleven" without apostrophe
]);

/**
 * Normalize title for matching: lowercase, trim, and convert & to "and"
 */
function normalizeForMatching(title: string): string {
  return title.toLowerCase().trim().replace(/\s*&\s*/g, ' and ');
}

/**
 * Score how well a search title matches a result title.
 * Higher score = better match. Returns 0 for no match.
 */
function scoreTitleMatch(searchTitle: string, resultTitle: string): number {
  const searchLower = normalizeForMatching(searchTitle);
  const resultLower = normalizeForMatching(resultTitle);

  // Exact match - best possible
  if (searchLower === resultLower) return 100;

  // Result is search + common prefix like "The" (e.g., "Blues Brothers" → "The Blues Brothers")
  const articlesPattern = /^(the|a|an)\s+/i;
  const resultWithoutArticle = resultLower.replace(articlesPattern, '');
  const searchWithoutArticle = searchLower.replace(articlesPattern, '');
  if (searchWithoutArticle === resultWithoutArticle) return 95;

  // Search matches result exactly after stripping article from result
  if (searchLower === resultWithoutArticle) return 90;

  // Result contains search as complete phrase, but has extra words
  // Penalize by how much extra content there is
  if (resultLower.includes(searchLower)) {
    const extraChars = resultLower.length - searchLower.length;
    // "Blues Brothers" (14) in "Blues Brothers 2000" (19) = 5 extra chars → score 75
    // "Blues Brothers" (14) in "The Blues Brothers" (18) = 4 extra chars → score 76
    // Cap penalty at 30 points
    const penalty = Math.min(extraChars * 2, 30);
    return 80 - penalty;
  }

  // Search contains result (unusual - search is longer than result)
  // Be very strict here: if the result is much shorter, it's likely a false match
  // e.g., searching "Oceans Eleven" should NOT match "Oceans" (6 chars vs 13 chars)
  if (searchLower.includes(resultLower)) {
    // Reject if result is less than 60% of search length
    // This prevents "Oceans" (6) matching "Oceans Eleven" (13) - ratio 0.46
    // But allows "Matrix" (6) matching "The Matrix" (10) - ratio 0.6
    const lengthRatio = resultLower.length / searchLower.length;
    if (lengthRatio < 0.6) {
      return 0; // Too short - likely wrong match
    }
    const extraChars = searchLower.length - resultLower.length;
    const penalty = Math.min(extraChars * 2, 30);
    return 70 - penalty;
  }

  // Partial word match - weakest
  const searchWords = searchLower.split(/\s+/).filter(w => w.length > 2);
  const resultWords = new Set(resultLower.split(/\s+/));
  const matchingWords = searchWords.filter(w => resultWords.has(w));

  if (searchWords.length > 0 && matchingWords.length >= searchWords.length * 0.5) {
    // Score based on percentage of words matching
    return Math.floor(40 * (matchingWords.length / searchWords.length));
  }

  return 0; // No match
}

/**
 * Validate movie or TV show against TMDB
 */
async function validateTMDB(
  title: string,
  mediaType: MediaType,
  apiKey: string
): Promise<ValidationResult> {
  const titleLower = title.toLowerCase().trim();
  const wordCount = titleLower.split(/\s+/).length;

  // Reject generic single words (but allow multi-word titles containing them)
  if (wordCount === 1 && GENERIC_WORDS.has(titleLower)) {
    return {
      title,
      validated: false,
      confidence: 'low',
    };
  }

  // Reject known cruft phrases (multi-word non-titles)
  if (titleLower === 'dad movie' || titleLower === 'mom movie') {
    return {
      title,
      validated: false,
      confidence: 'low',
    };
  }

  // Reject very short titles (likely not real movie names)
  if (title.length < 3) {
    return {
      title,
      validated: false,
      confidence: 'low',
    };
  }

  const endpoint = mediaType === 'MOVIE' ? '/search/movie' : '/search/tv';
  // Normalize the search query: convert & to "and" for better TMDB matching
  const searchQuery = title.replace(/\s*&\s*/g, ' and ');
  const url = `https://api.themoviedb.org/3${endpoint}?query=${encodeURIComponent(searchQuery)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.results.length === 0) {
    return {
      title,
      validated: false,
      confidence: 'low',
    };
  }

  // Score all results and pick the best match
  let bestMatch: { result: TMDBResult; resultTitle: string; score: number } | null = null;

  for (const result of data.results.slice(0, 10)) {
    const resultTitle = mediaType === 'MOVIE' ? result.title : result.name;
    const score = scoreTitleMatch(title, resultTitle);

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { result, resultTitle, score };
    }
  }

  if (bestMatch) {
    const confidence = calculateTMDBConfidence(bestMatch.result);

    return {
      title: bestMatch.resultTitle,
      validated: true,
      confidence,
      source: 'tmdb',
      metadata: {
        id: bestMatch.result.id,
        releaseDate: bestMatch.result.release_date || bestMatch.result.first_air_date,
        voteAverage: bestMatch.result.vote_average,
        popularity: bestMatch.result.popularity,
      },
    };
  }

  // No good match found
  return {
    title,
    validated: false,
    confidence: 'low',
  };
}

/**
 * Calculate confidence from TMDB result
 */
function calculateTMDBConfidence(result: TMDBResult): 'high' | 'medium' | 'low' {
  const voteCount = result.vote_count || 0;
  const popularity = result.popularity || 0;

  // High confidence: popular and well-rated
  if (voteCount >= 1000 && popularity >= 20) {
    return 'high';
  }

  // Medium confidence: some votes or popularity
  if (voteCount >= 100 || popularity >= 5) {
    return 'medium';
  }

  return 'low';
}

/**
 * Validate music against MusicBrainz
 */
async function validateMusicBrainz(title: string, userAgent: string): Promise<ValidationResult> {
  // Use fuzzy search with Lucene syntax
  const query = `recording:${title}~0.8`;
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=5`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
    },
  });

  if (!response.ok) {
    throw new Error(`MusicBrainz API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.recordings.length === 0) {
    return {
      title,
      validated: false,
      confidence: 'low',
    };
  }

  // Take highest score result
  const result: MusicBrainzResult = data.recordings[0];

  // Calculate confidence from MusicBrainz score (0-100)
  const confidence = calculateMusicBrainzConfidence(result.score ?? 0);

  // Extract artist
  const artist =
    result['artist-credit'] && result['artist-credit'][0]
      ? result['artist-credit'][0].name
      : undefined;

  return {
    title: result.title,
    validated: true,
    confidence,
    source: 'musicbrainz',
    artist,
    metadata: {
      id: result.id,
    },
  };
}

/**
 * Calculate confidence from MusicBrainz score
 */
function calculateMusicBrainzConfidence(score: number): 'high' | 'medium' | 'low' {
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

type PagesContext = {
  request: Request;
  env: CloudflareEnv;
};

/**
 * Cloudflare Pages Functions handler for OPTIONS (CORS preflight)
 */
export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: corsHeaders });
}

/**
 * Cloudflare Pages Functions handler for POST
 */
export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request, env } = context;

  try {
    const { title, mediaType } = await request.json();

    if (!title || !mediaType) {
      return new Response('Missing title or mediaType', { status: 400 });
    }

    const result = await validateMention(title, mediaType as MediaType, {
      tmdbApiKey: env.TMDB_API_KEY,
      musicbrainzUserAgent: env.MUSICBRAINZ_USER_AGENT,
      cache: env.VALIDATION_CACHE,
    });

    return new Response(JSON.stringify(result), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
}
// Deployed at Thu, Feb  5, 2026  2:15:18 PM
