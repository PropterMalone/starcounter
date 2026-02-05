import type {
  AtUri,
  GetPostThreadResponse,
  GetQuotesResponse,
  RateLimitInfo,
  Result,
} from '../types';
import { getRateLimiter } from './rate-limiter';

const BASE_URL = 'https://public.api.bsky.app';

export interface GetPostThreadOptions {
  depth?: number;
  parentHeight?: number;
  maxRetries?: number;
}

export interface GetQuotesOptions {
  cursor?: string;
  limit?: number;
  maxRetries?: number;
}

/**
 * Client for Bluesky AT Protocol public API
 * Handles thread fetching, quote fetching, and rate limiting
 */
export class BlueskyClient {
  private lastRateLimitInfo: RateLimitInfo | null = null;
  private readonly rateLimiter = getRateLimiter();

  /**
   * Fetch a post thread with replies
   * @param uri - AT-URI of the post
   * @param options - Depth, parent height, and retry configuration
   */
  async getPostThread(
    uri: AtUri,
    options: GetPostThreadOptions = {}
  ): Promise<Result<GetPostThreadResponse>> {
    const { depth = 6, parentHeight = 80, maxRetries = 3 } = options;

    const params = new URLSearchParams({
      uri,
      depth: String(depth),
      parentHeight: String(parentHeight),
    });

    const url = `${BASE_URL}/xrpc/app.bsky.feed.getPostThread?${params}`;

    return this.fetchWithRetry<GetPostThreadResponse>(url, maxRetries);
  }

  /**
   * Fetch quote posts for a given post
   * @param uri - AT-URI of the post
   * @param options - Pagination cursor, limit, and retry configuration
   */
  async getQuotes(
    uri: AtUri,
    options: GetQuotesOptions = {}
  ): Promise<Result<GetQuotesResponse>> {
    const { cursor, limit = 50, maxRetries = 3 } = options;

    const params = new URLSearchParams({
      uri,
      limit: String(limit),
    });

    if (cursor) {
      params.set('cursor', cursor);
    }

    const url = `${BASE_URL}/xrpc/app.bsky.feed.getQuotes?${params}`;

    return this.fetchWithRetry<GetQuotesResponse>(url, maxRetries);
  }

  /**
   * Get rate limit information from the last API response
   */
  getLastRateLimitInfo(): RateLimitInfo | null {
    return this.lastRateLimitInfo;
  }

  /**
   * Fetch with automatic retry on 429 and exponential backoff
   */
  private async fetchWithRetry<T>(
    url: string,
    maxRetries: number,
    attempt = 0
  ): Promise<Result<T>> {
    // Wait for rate limiter slot
    await this.rateLimiter.waitForSlot();

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Record request with rate limiter
      this.rateLimiter.recordRequest();

      // Parse rate limit headers
      this.parseRateLimitHeaders(response.headers);

      // Handle rate limiting (429)
      if (response.status === 429) {
        if (attempt >= maxRetries) {
          return {
            ok: false,
            error: new Error(`Rate limit exceeded after ${maxRetries} retries`),
          };
        }

        // Calculate wait time from headers
        const resetTime = parseInt(response.headers.get('ratelimit-reset') || '0');
        const retryAfter = parseInt(response.headers.get('retry-after') || '0');

        const waitTime = resetTime
          ? Math.max(0, resetTime - Math.floor(Date.now() / 1000)) * 1000
          : retryAfter * 1000 || Math.pow(2, attempt) * 1000;

        // Wait and retry
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.fetchWithRetry<T>(url, maxRetries, attempt + 1);
      }

      // Handle other errors
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          ok: false,
          error: new Error(
            errorData.message || `HTTP ${response.status}: ${response.statusText}`
          ),
        };
      }

      // Success
      const data = await response.json();
      return { ok: true, value: data };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Parse rate limit information from response headers
   */
  private parseRateLimitHeaders(headers: Headers): void {
    const limit = headers.get('ratelimit-limit');
    const remaining = headers.get('ratelimit-remaining');
    const reset = headers.get('ratelimit-reset');
    const policy = headers.get('ratelimit-policy');

    if (limit && remaining && reset) {
      this.lastRateLimitInfo = {
        limit: parseInt(limit),
        remaining: parseInt(remaining),
        reset: parseInt(reset),
        policy: policy || '',
      };
    }
  }
}
