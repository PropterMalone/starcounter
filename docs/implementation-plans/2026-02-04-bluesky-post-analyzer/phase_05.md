# Starcounter: Bluesky Post Analyzer Implementation Plan - Phase 5

**Goal:** Fuzzy-match mentions against TMDB and MusicBrainz APIs

**Architecture:** Cloudflare Workers serverless function for validation, result caching with 15-min TTL, confidence scoring

**Tech Stack:** Cloudflare Workers, TMDB API (50 req/sec), MusicBrainz API (1 req/sec), fetch with retry logic

**Scope:** Phase 5 of 8 phases from original design

**Codebase verified:** 2026-02-04 (Phase 3 provides mention types, Phase 4 provides counting)

---

## Phase Overview

This phase implements a serverless validation function that fuzzy-matches extracted mentions against external databases. TMDB validates movies/TV shows (50 req/sec limit), MusicBrainz validates music (strict 1 req/sec limit). Results are cached for 15 minutes to reduce API calls. Confidence scores help identify ambiguous matches. The client-side wrapper handles batching and progress reporting.

**API specifics:**
- **TMDB**: `/3/search/movie` and `/3/search/tv` endpoints, Bearer token auth, popularity + vote_count for quality
- **MusicBrainz**: `/ws/2/recording` and `/ws/2/artist` endpoints, User-Agent required, Lucene fuzzy search (`~`), score field (0-100)

**Rate limiting:**
- TMDB: 50 requests/second max, no daily limit
- MusicBrainz: 1 request/second strict, exponential backoff on 503

**Testing:** Mock external APIs, test caching, test rate limiting, 95% coverage target

---

<!-- START_TASK_1 -->
### Task 1: Create Cloudflare Workers configuration

**Files:**
- Create: `wrangler.toml`
- Modify: `.gitignore`

**Step 1: Create wrangler.toml**

```toml
name = "starcounter-validation"
main = "functions/api/validate.ts"
compatibility_date = "2024-01-01"

[env.production]
name = "starcounter-validation-prod"

[env.development]
name = "starcounter-validation-dev"

# Environment variables (set via Cloudflare dashboard or wrangler secret)
# TMDB_API_KEY - TMDB Bearer token
# MUSICBRAINZ_USER_AGENT - User-Agent string for MusicBrainz

# KV namespace for caching (create via: wrangler kv:namespace create "VALIDATION_CACHE")
[[kv_namespaces]]
binding = "VALIDATION_CACHE"
id = "placeholder_id" # Replace with actual KV namespace ID
preview_id = "placeholder_preview_id" # Replace with preview namespace ID
```

**Step 2: Update .gitignore**

Add to `.gitignore`:

```
# Cloudflare Workers
.wrangler/
wrangler.toml.bak
```

**Step 3: Verify wrangler.toml syntax**

Run: `cat wrangler.toml | head -10`

Expected: File displays correctly

**Step 4: Commit**

```bash
git add wrangler.toml .gitignore
git commit -m "chore: add Cloudflare Workers configuration

- wrangler.toml for serverless functions
- KV namespace for validation caching
- Environment variable placeholders
- Ignore wrangler build artifacts

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-4) -->
<!-- START_TASK_2 -->
### Task 2: Write validation function test (TDD)

**Files:**
- Create: `functions/api/validate.test.ts`

**Step 1: Create functions/api directory**

Run: `mkdir -p functions/api`

**Step 2: Write failing test**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateMention } from './validate';
import { MediaType } from '../../src/lib/mention-extractor';

// Mock fetch globally
global.fetch = vi.fn();

describe('validateMention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('TMDB movie validation', () => {
    it('should validate movie against TMDB', async () => {
      const mockResponse = {
        results: [
          {
            id: 603,
            title: 'The Matrix',
            release_date: '1999-03-31',
            vote_average: 8.2,
            vote_count: 21500,
            popularity: 45.6,
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await validateMention('The Matrix', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
      });

      expect(result.validated).toBe(true);
      expect(result.title).toBe('The Matrix');
      expect(result.confidence).toBe('high');
      expect(result.source).toBe('tmdb');
    });

    it('should return low confidence for no matches', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      const result = await validateMention('Nonexistent Movie', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });
  });

  describe('TMDB TV show validation', () => {
    it('should validate TV show against TMDB', async () => {
      const mockResponse = {
        results: [
          {
            id: 1396,
            name: 'Breaking Bad',
            first_air_date: '2008-01-20',
            vote_average: 9.5,
            vote_count: 10500,
            popularity: 120.5,
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await validateMention('Breaking Bad', MediaType.TV_SHOW, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
      });

      expect(result.validated).toBe(true);
      expect(result.title).toBe('Breaking Bad');
      expect(result.source).toBe('tmdb');
    });
  });

  describe('MusicBrainz validation', () => {
    it('should validate music against MusicBrainz', async () => {
      const mockResponse = {
        recordings: [
          {
            id: 'abc-123',
            title: 'Bohemian Rhapsody',
            score: 100,
            'artist-credit': [
              {
                name: 'Queen',
                artist: { id: 'def-456', name: 'Queen' },
              },
            ],
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await validateMention('Bohemian Rhapsody', MediaType.MUSIC, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
      });

      expect(result.validated).toBe(true);
      expect(result.title).toBe('Bohemian Rhapsody');
      expect(result.artist).toBe('Queen');
      expect(result.source).toBe('musicbrainz');
    });

    it('should use fuzzy search for MusicBrainz', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ recordings: [] }),
      });

      await validateMention('Bohemian Rhapsody', MediaType.MUSIC, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
      });

      const callUrl = (global.fetch as any).mock.calls[0][0];
      expect(callUrl).toContain('~'); // Fuzzy operator
    });
  });

  describe('confidence scoring', () => {
    it('should return high confidence for exact matches', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'The Matrix',
              vote_count: 20000,
              popularity: 50,
            },
          ],
        }),
      });

      const result = await validateMention('The Matrix', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
      });

      expect(result.confidence).toBe('high');
    });

    it('should return medium confidence for popular but weak matches', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Matrix',
              vote_count: 500,
              popularity: 10,
            },
          ],
        }),
      });

      const result = await validateMention('The Matrix', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
      });

      expect(result.confidence).toBe('medium');
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const result = await validateMention('The Matrix', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
      });

      expect(result.validated).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should handle API errors', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await validateMention('The Matrix', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
      });

      expect(result.validated).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npm test functions/api/validate.test.ts`

Expected: Test fails with "Cannot find module './validate'"

**Step 4: Commit**

```bash
git add functions/api/validate.test.ts
git commit -m "test: add validation function tests (TDD - failing)

- TMDB movie and TV validation
- MusicBrainz music validation with fuzzy search
- Confidence scoring (high/medium/low)
- Error handling (network, API errors)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Implement validation serverless function

**Files:**
- Create: `functions/api/validate.ts`

**Step 1: Write validation function**

```typescript
import { MediaType } from '../../src/lib/mention-extractor';

export interface ValidationOptions {
  tmdbApiKey: string;
  musicbrainzUserAgent: string;
  cache?: KVNamespace; // Cloudflare KV for caching
}

export interface ValidationResult {
  title: string;
  validated: boolean;
  confidence: 'high' | 'medium' | 'low';
  source?: 'tmdb' | 'musicbrainz';
  artist?: string; // For music
  metadata?: {
    id?: string | number;
    releaseDate?: string;
    voteAverage?: number;
    popularity?: number;
  };
  error?: string;
}

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
    if (mediaType === MediaType.MOVIE || mediaType === MediaType.TV_SHOW) {
      result = await validateTMDB(title, mediaType, options.tmdbApiKey);
    } else if (mediaType === MediaType.MUSIC) {
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
  const endpoint =
    mediaType === MediaType.MOVIE ? '/3/search/movie' : '/3/search/tv';
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
  const resultTitle = mediaType === MediaType.MOVIE ? result.title : result.name;

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
function calculateTMDBConfidence(result: any): 'high' | 'medium' | 'low' {
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
async function validateMusicBrainz(
  title: string,
  userAgent: string
): Promise<ValidationResult> {
  // Use fuzzy search with Lucene syntax
  const query = `recording:${title}~0.8`;
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=5`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
    },
  });

  if (!response.ok) {
    throw new Error(
      `MusicBrainz API error: ${response.status} ${response.statusText}`
    );
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
  const result = data.recordings[0];

  // Calculate confidence from MusicBrainz score (0-100)
  const confidence = calculateMusicBrainzConfidence(result.score);

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
  async fetch(request: Request, env: any): Promise<Response> {
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
```

**Step 2: Run test to verify it passes**

Run: `npm test functions/api/validate.test.ts`

Expected: All tests pass

**Step 3: Commit**

```bash
git add functions/api/validate.ts
git commit -m "feat: implement validation serverless function

- TMDB movie/TV validation with Bearer auth
- MusicBrainz music validation with fuzzy search
- Confidence scoring based on vote counts and scores
- Result caching with 15-min TTL (KV namespace)
- CORS support for client requests
- Error handling with graceful fallbacks
- All tests passing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Verify validation function coverage

**Files:**
- Verify: `functions/api/validate.test.ts` and `functions/api/validate.ts`

**Step 1: Run coverage check**

Run: `npm run test:coverage -- functions/api/validate`

Expected: Coverage ≥95%

**Step 2: Add edge case tests if needed**

Common gaps:
- Cache hit scenario
- Rate limiting (503 from MusicBrainz)
- Multiple results with different confidence levels
- Missing metadata fields

**Step 3: Commit if tests were added**

If needed:

```bash
git add functions/api/validate.test.ts
git commit -m "test: increase validation function coverage to 95%+

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 5-6) -->
<!-- START_TASK_5 -->
### Task 5: Create client-side validation wrapper

**Files:**
- Create: `src/lib/validation-client.ts`
- Create: `src/lib/validation-client.test.ts`

**Step 1: Write validation client wrapper**

```typescript
import type { MediaMention } from './mention-extractor';

export interface ValidationProgress {
  total: number;
  completed: number;
  currentTitle: string;
}

export interface ValidationClientOptions {
  apiUrl: string;
  onProgress?: (progress: ValidationProgress) => void;
  batchSize?: number;
  batchDelayMs?: number;
}

/**
 * Client-side wrapper for validation API
 * Handles batching and progress reporting
 */
export class ValidationClient {
  private options: Required<ValidationClientOptions>;

  constructor(options: ValidationClientOptions) {
    this.options = {
      batchSize: 10,
      batchDelayMs: 100,
      onProgress: () => {},
      ...options,
    };
  }

  /**
   * Validate multiple mentions with progress reporting
   */
  async validateMentions(mentions: MediaMention[]): Promise<MediaMention[]> {
    const validated: MediaMention[] = [];
    const total = mentions.length;

    // Process in batches to avoid overwhelming the API
    for (let i = 0; i < mentions.length; i += this.options.batchSize) {
      const batch = mentions.slice(i, i + this.options.batchSize);

      const batchResults = await Promise.all(
        batch.map((mention) => this.validateSingle(mention))
      );

      validated.push(...batchResults);

      // Report progress
      this.options.onProgress({
        total,
        completed: validated.length,
        currentTitle: batch[batch.length - 1].title,
      });

      // Delay between batches (except last)
      if (i + this.options.batchSize < mentions.length) {
        await new Promise((resolve) => setTimeout(resolve, this.options.batchDelayMs));
      }
    }

    return validated;
  }

  /**
   * Validate a single mention
   */
  private async validateSingle(mention: MediaMention): Promise<MediaMention> {
    try {
      const response = await fetch(this.options.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: mention.title,
          mediaType: mention.mediaType,
        }),
      });

      if (!response.ok) {
        // Validation failed, return original mention
        return mention;
      }

      const result = await response.json();

      // Merge validation result with original mention
      return {
        ...mention,
        validated: result.validated,
        validationConfidence: result.confidence,
        validatedTitle: result.title,
        artist: result.artist || mention.artist,
      };
    } catch (error) {
      // Network error, return original mention
      return mention;
    }
  }
}
```

**Step 2: Write test for validation client**

Create `src/lib/validation-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ValidationClient } from './validation-client';
import type { MediaMention } from './mention-extractor';
import { MediaType } from './mention-extractor';

global.fetch = vi.fn();

describe('ValidationClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should validate mentions with progress reporting', async () => {
    const mentions: MediaMention[] = [
      {
        title: 'The Matrix',
        normalizedTitle: 'matrix',
        mediaType: MediaType.MOVIE,
        confidence: 'high',
      },
      {
        title: 'Inception',
        normalizedTitle: 'inception',
        mediaType: MediaType.MOVIE,
        confidence: 'high',
      },
    ];

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ validated: true, confidence: 'high', title: 'The Matrix' }),
    });

    const progressUpdates: any[] = [];
    const client = new ValidationClient({
      apiUrl: 'http://test.com/api/validate',
      onProgress: (progress) => progressUpdates.push(progress),
    });

    const result = await client.validateMentions(mentions);

    expect(result).toHaveLength(2);
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[progressUpdates.length - 1].completed).toBe(2);
  });

  it('should batch requests', async () => {
    const mentions: MediaMention[] = Array(25)
      .fill(null)
      .map((_, i) => ({
        title: `Title ${i}`,
        normalizedTitle: `title${i}`,
        mediaType: MediaType.MOVIE,
        confidence: 'high',
      }));

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ validated: true, confidence: 'high' }),
    });

    const client = new ValidationClient({
      apiUrl: 'http://test.com/api/validate',
      batchSize: 10,
      batchDelayMs: 10,
    });

    await client.validateMentions(mentions);

    // Should make 25 fetch calls (not batched at API level, but delayed)
    expect((global.fetch as any).mock.calls.length).toBe(25);
  });

  it('should handle validation errors gracefully', async () => {
    const mentions: MediaMention[] = [
      {
        title: 'Unknown',
        normalizedTitle: 'unknown',
        mediaType: MediaType.MOVIE,
        confidence: 'high',
      },
    ];

    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
    });

    const client = new ValidationClient({
      apiUrl: 'http://test.com/api/validate',
    });

    const result = await client.validateMentions(mentions);

    // Should return original mention on error
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Unknown');
  });
});
```

**Step 3: Run tests**

Run: `npm test src/lib/validation-client.test.ts`

Expected: All tests pass

**Step 4: Commit**

```bash
git add src/lib/validation-client.ts src/lib/validation-client.test.ts
git commit -m "feat: add client-side validation wrapper

- Batch processing with configurable batch size
- Progress reporting for UI updates
- Error handling with fallback to original mentions
- Delay between batches to respect rate limits
- All tests passing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Update lib exports and verify Phase 5

**Files:**
- Modify: `src/lib/index.ts`

**Step 1: Add validation client to exports**

Update `src/lib/index.ts`:

```typescript
export { ValidationClient } from './validation-client';
export type { ValidationProgress, ValidationClientOptions } from './validation-client';
```

**Step 2: Run full test suite**

Run: `npm test`

Expected: All tests pass (Phase 1-5 modules)

**Step 3: Run coverage**

Run: `npm run test:coverage`

Expected: Overall ≥95% coverage

**Step 4: Commit**

```bash
git add src/lib/index.ts
git commit -m "feat: add validation client to exports

- Export ValidationClient, ValidationProgress, ValidationClientOptions
- Complete Phase 5 public API

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_B -->

---

## Phase 5 Complete

**Deliverables:**
- ✓ wrangler.toml Cloudflare Workers configuration
- ✓ functions/api/validate.ts serverless validation function
- ✓ functions/api/validate.test.ts with TMDB and MusicBrainz tests (95%+ coverage)
- ✓ src/lib/validation-client.ts client-side wrapper with batching
- ✓ src/lib/validation-client.test.ts with progress and error tests (95%+ coverage)
- ✓ Updated src/lib/index.ts with validation exports
- ✓ All tests passing
- ✓ 95%+ coverage achieved

**Verification:**
- `npm test` passes all tests
- `npm run test:coverage` shows ≥95% coverage
- `npm run validate` passes

**Deployment notes:**
- Create KV namespace: `wrangler kv:namespace create "VALIDATION_CACHE"`
- Set secrets: `wrangler secret put TMDB_API_KEY` and `wrangler secret put MUSICBRAINZ_USER_AGENT`
- Deploy: `wrangler publish`

**Next Phase:** Phase 6 will implement client UI with progress tracking, form handling, chart rendering, and drill-down functionality
