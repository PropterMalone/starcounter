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

const CACHE_TTL = 15 * 60; // 15 minutes in seconds

/**
 * Validate a mention against external APIs
 */
export async function validateMention(
  title: string,
  mediaType: MediaType,
  options: ValidationOptions
): Promise<ValidationResult> {
  // Check cache
  if (options.cache) {
    const cacheKey = `${mediaType}:${title.toLowerCase()}`;
    const cached = await options.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as ValidationResult;
    }
  }

  let result: ValidationResult;

  try {
    if (mediaType === 'MOVIE' || mediaType === 'TV_SHOW') {
      result = await validateTMDB(title, mediaType, options.tmdbApiKey);
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

  // Cache result
  if (options.cache) {
    const cacheKey = `${mediaType}:${title.toLowerCase()}`;
    await options.cache.put(cacheKey, JSON.stringify(result), {
      expirationTtl: CACHE_TTL,
    });
  }

  return result;
}

/**
 * Validate movie or TV show against TMDB
 */
async function validateTMDB(
  title: string,
  mediaType: MediaType,
  apiKey: string
): Promise<ValidationResult> {
  const endpoint = mediaType === 'MOVIE' ? '/3/search/movie' : '/3/search/tv';
  const url = `https://api.themoviedb.org/3${endpoint}?query=${encodeURIComponent(title)}`;

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

  // Take first result (sorted by popularity)
  const result = data.results[0];
  const resultTitle = mediaType === 'MOVIE' ? result.title : result.name;

  // Calculate confidence based on vote_count and popularity
  const confidence = calculateTMDBConfidence(result);

  return {
    title: resultTitle,
    validated: true,
    confidence,
    source: 'tmdb',
    metadata: {
      id: result.id,
      releaseDate: result.release_date || result.first_air_date,
      voteAverage: result.vote_average,
      popularity: result.popularity,
    },
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

/**
 * Cloudflare Workers handler
 */
export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle OPTIONS (CORS preflight)
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only POST allowed
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

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
  },
};
