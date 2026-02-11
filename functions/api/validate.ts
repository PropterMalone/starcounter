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
  readonly name?: string;
  readonly 'sort-name'?: string;
  readonly score?: number;
  readonly 'artist-credit'?: Array<{ readonly name: string }>;
};

type IGDBResult = {
  readonly id?: number;
  readonly name?: string;
  readonly slug?: string;
  readonly first_release_date?: number; // Unix timestamp
  readonly rating?: number; // IGDB user rating (0-100)
  readonly rating_count?: number;
  readonly aggregated_rating?: number; // Critics rating (0-100)
  readonly aggregated_rating_count?: number;
  readonly total_rating?: number; // Combined rating
};

type CloudflareEnv = {
  readonly TMDB_API_KEY: string;
  readonly MUSICBRAINZ_USER_AGENT: string;
  readonly TWITCH_CLIENT_ID: string;
  readonly TWITCH_CLIENT_SECRET: string;
};

export type ValidationOptions = {
  readonly tmdbApiKey: string;
  readonly musicbrainzUserAgent: string;
  readonly twitchClientId: string;
  readonly twitchClientSecret: string;
};

export type ValidationResult = {
  readonly title: string;
  readonly validated: boolean;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly source?: 'tmdb' | 'musicbrainz' | 'igdb';
  readonly artist?: string; // For music
  readonly metadata?: {
    readonly id?: string | number;
    readonly releaseDate?: string;
    readonly voteAverage?: number;
    readonly popularity?: number;
    readonly metacritic?: number; // For video games
  };
  readonly error?: string;
};

/**
 * Validate a mention against external APIs
 */
export async function validateMention(
  title: string,
  mediaType: MediaType,
  options: ValidationOptions
): Promise<ValidationResult> {
  let result: ValidationResult;

  try {
    if (mediaType === 'MOVIE' || mediaType === 'TV_SHOW' || mediaType === 'UNKNOWN') {
      // For UNKNOWN, default to movie search since this is primarily a movie analyzer
      result = await validateTMDB(
        title,
        mediaType === 'UNKNOWN' ? 'MOVIE' : mediaType,
        options.tmdbApiKey
      );
    } else if (
      mediaType === 'MUSIC' ||
      mediaType === 'SONG' ||
      mediaType === 'ALBUM' ||
      mediaType === 'ARTIST'
    ) {
      result = await validateMusicBrainz(title, mediaType, options.musicbrainzUserAgent);
    } else if (mediaType === 'VIDEO_GAME') {
      result = await validateIGDB(title, options.twitchClientId, options.twitchClientSecret);
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

  return result;
}

// Common words that shouldn't be movie titles on their own
const GENERIC_WORDS = new Set([
  'good',
  'great',
  'bad',
  'best',
  'worst',
  'nice',
  'cool',
  'awesome',
  'night',
  'day',
  'morning',
  'evening',
  'today',
  'yesterday',
  'tomorrow',
  'still',
  'stuff',
  'thing',
  'things',
  'every',
  'which',
  'what',
  'where',
  'when',
  'who',
  'how',
  'father',
  'mother',
  'brother',
  'sister',
  'son',
  'daughter',
  'dad',
  'mom',
  'hunt',
  'master',
  'commander',
  'bride',
  'last',
  'first',
  'field',
  'dreams',
  'movie',
  'film',
  'show',
  'watch',
  'watching',
  'watched',
  'seen',
  'see',
  'love',
  'like',
  'hate',
  'want',
  'need',
  'think',
  'know',
  'feel',
  'time',
  'year',
  'years',
  'old',
  'new',
  'big',
  'small',
  'long',
  'short',
  'man',
  'woman',
  'people',
  'person',
  'life',
  'world',
  'way',
  'part',
  'just',
  'really',
  'actually',
  'probably',
  'maybe',
  'always',
  'never',
  'dad movie',
  'mom movie',
  'classic',
  'favorite',
  'favourite',
  'ocean',
  'oceans', // Often false positive from "Ocean's Eleven" without apostrophe
]);

/**
 * Normalize title for matching: lowercase, trim, and convert & to "and"
 */
function normalizeForMatching(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/\s*&\s*/g, ' and ');
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
  const searchWords = searchLower.split(/\s+/).filter((w) => w.length > 2);
  const resultWords = new Set(resultLower.split(/\s+/));
  const matchingWords = searchWords.filter((w) => resultWords.has(w));

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
 * Validate music against MusicBrainz.
 *
 * Routes to the appropriate endpoint based on mediaType:
 *   SONG / MUSIC → /recording (search by recording title)
 *   ALBUM        → /release   (search by release title)
 *   ARTIST       → /artist    (search by artist name)
 */
async function validateMusicBrainz(
  title: string,
  mediaType: MediaType,
  userAgent: string
): Promise<ValidationResult> {
  const titleLower = title.toLowerCase().trim();
  const wordCount = titleLower.split(/\s+/).length;

  // Reject generic single words (same as TMDB/IGDB)
  if (wordCount === 1 && GENERIC_WORDS.has(titleLower)) {
    return { title, validated: false, confidence: 'low' };
  }

  // Reject very short titles
  if (title.length < 3) {
    return { title, validated: false, confidence: 'low' };
  }

  let endpoint: string;
  let queryField: string;
  let resultsKey: string;

  if (mediaType === 'ALBUM') {
    endpoint = 'release';
    queryField = 'release';
    resultsKey = 'releases';
  } else if (mediaType === 'ARTIST') {
    endpoint = 'artist';
    queryField = 'artist';
    resultsKey = 'artists';
  } else {
    // SONG, MUSIC, or fallback
    endpoint = 'recording';
    queryField = 'recording';
    resultsKey = 'recordings';
  }

  const query = `${queryField}:${title}`;
  const url = `https://musicbrainz.org/ws/2/${endpoint}/?query=${encodeURIComponent(query)}&fmt=json&limit=20`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
    },
  });

  if (!response.ok) {
    throw new Error(`MusicBrainz API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const results: MusicBrainzResult[] = data[resultsKey] ?? [];

  if (results.length === 0) {
    return {
      title,
      validated: false,
      confidence: 'low',
    };
  }

  // Score all results and pick the best match (same pattern as TMDB/IGDB).
  // MusicBrainz ranks by term frequency, so "Fear" returns "Fear Fear Fear" first.
  // Require score >= 75 to reject these false positives.
  const MIN_MUSICBRAINZ_SCORE = 75;
  let bestMatch: { result: MusicBrainzResult; resultTitle: string; score: number } | null = null;

  for (const result of results) {
    const resultTitle = mediaType === 'ARTIST' ? result.name : result.title;
    if (!resultTitle) continue;
    const score = scoreTitleMatch(title, resultTitle);

    if (score >= MIN_MUSICBRAINZ_SCORE && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { result, resultTitle, score };
    }
  }

  if (bestMatch) {
    const confidence = calculateMusicBrainzConfidence(bestMatch.result.score ?? 0);

    // Extract artist credit (not present on artist results)
    const artist =
      bestMatch.result['artist-credit'] && bestMatch.result['artist-credit'][0]
        ? bestMatch.result['artist-credit'][0].name
        : undefined;

    return {
      title: bestMatch.resultTitle,
      validated: true,
      confidence,
      source: 'musicbrainz',
      artist,
      metadata: {
        id: bestMatch.result.id,
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
 * Calculate confidence from MusicBrainz score
 */
function calculateMusicBrainzConfidence(score: number): 'high' | 'medium' | 'low' {
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

/**
 * Get Twitch OAuth token for IGDB API
 * Tokens last 60 days, so we fetch fresh each time (could cache in KV for optimization)
 */
async function getTwitchAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    { method: 'POST' }
  );

  if (!response.ok) {
    throw new Error(`Twitch OAuth error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Validate video game against IGDB API
 */
async function validateIGDB(
  title: string,
  clientId: string,
  clientSecret: string
): Promise<ValidationResult> {
  const titleLower = title.toLowerCase().trim();

  // Reject very short titles
  if (title.length < 2) {
    return {
      title,
      validated: false,
      confidence: 'low',
    };
  }

  // Reject generic single words that are unlikely to be game titles
  const wordCount = titleLower.split(/\s+/).length;
  if (wordCount === 1 && GENERIC_WORDS.has(titleLower)) {
    return {
      title,
      validated: false,
      confidence: 'low',
    };
  }

  // Get Twitch access token
  const accessToken = await getTwitchAccessToken(clientId, clientSecret);

  // IGDB uses a POST body with their query language
  const query = `search "${title.replace(/"/g, '\\"')}"; fields name,slug,first_release_date,rating,rating_count,aggregated_rating,aggregated_rating_count,total_rating; limit 10;`;

  const response = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': clientId,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'text/plain',
    },
    body: query,
  });

  if (!response.ok) {
    throw new Error(`IGDB API error: ${response.status} ${response.statusText}`);
  }

  const results: IGDBResult[] = await response.json();

  if (!results || results.length === 0) {
    return {
      title,
      validated: false,
      confidence: 'low',
    };
  }

  // Score all results and pick the best match
  let bestMatch: { result: IGDBResult; score: number } | null = null;

  for (const result of results.slice(0, 10)) {
    const resultTitle = result.name ?? '';
    const score = scoreTitleMatch(title, resultTitle);

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { result, score };
    }
  }

  if (bestMatch) {
    const confidence = calculateIGDBConfidence(bestMatch.result);

    // Convert Unix timestamp to ISO date string
    const releaseDate = bestMatch.result.first_release_date
      ? new Date(bestMatch.result.first_release_date * 1000).toISOString().split('T')[0]
      : undefined;

    return {
      title: bestMatch.result.name,
      validated: true,
      confidence,
      source: 'igdb',
      metadata: {
        id: bestMatch.result.id,
        releaseDate,
        voteAverage: bestMatch.result.total_rating
          ? Math.round(bestMatch.result.total_rating) / 10
          : undefined, // Convert 0-100 to 0-10 scale
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
 * Calculate confidence from IGDB result
 */
function calculateIGDBConfidence(result: IGDBResult): 'high' | 'medium' | 'low' {
  const ratingCount = result.rating_count || 0;
  const aggregatedRatingCount = result.aggregated_rating_count || 0;
  const totalRatings = ratingCount + aggregatedRatingCount;

  // High confidence: has both user and critic ratings, or many user ratings
  if ((ratingCount >= 50 && aggregatedRatingCount >= 5) || ratingCount >= 500) {
    return 'high';
  }

  // Medium confidence: some ratings
  if (totalRatings >= 20 || aggregatedRatingCount >= 3) {
    return 'medium';
  }

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
      twitchClientId: env.TWITCH_CLIENT_ID,
      twitchClientSecret: env.TWITCH_CLIENT_SECRET,
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

/**
 * Default export for Cloudflare Workers compatibility
 * Provides the standard `fetch` handler interface
 */
export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return onRequestOptions();
    }

    if (request.method === 'POST') {
      return onRequestPost({ request, env });
    }

    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    });
  },
};
