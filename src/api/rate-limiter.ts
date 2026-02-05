/**
 * Token bucket rate limiter for Bluesky API
 * Limits: 3000 requests per 5 minutes (conservative: 2500)
 * Minimum delay: 50ms between requests
 */

export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  minDelayMs?: number;
}

export interface RateLimiterStats {
  used: number;
  remaining: number;
  windowResetMs: number;
}

export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly minDelayMs: number;
  private requests: number[] = []; // Timestamps of requests
  private lastRequestTime = 0;

  constructor(options: RateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    this.minDelayMs = options.minDelayMs ?? 0;
  }

  /**
   * Wait until a slot is available for the next request
   * Respects both the rate limit window and minimum delay
   */
  async waitForSlot(): Promise<void> {
    // Remove expired requests from window
    this.cleanupExpiredRequests();

    // Calculate how long to wait
    let waitMs = 0;

    // Check minimum delay since last request
    if (this.minDelayMs > 0 && this.lastRequestTime > 0) {
      const timeSinceLastRequest = Date.now() - this.lastRequestTime;
      const minDelayWait = this.minDelayMs - timeSinceLastRequest;
      waitMs = Math.max(waitMs, minDelayWait);
    }

    // Check if at rate limit
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0]!;
      const windowWait = this.windowMs - (Date.now() - oldestRequest);
      waitMs = Math.max(waitMs, windowWait);
    }

    // Wait if needed
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));

      // After waiting, clean up again and recurse if still blocked
      this.cleanupExpiredRequests();
      if (this.requests.length >= this.maxRequests) {
        return this.waitForSlot();
      }
    }
  }

  /**
   * Record that a request was made
   * Call this after making the API request
   */
  recordRequest(): void {
    const now = Date.now();
    this.requests.push(now);
    this.lastRequestTime = now;
  }

  /**
   * Get current rate limiter statistics
   */
  getStats(): RateLimiterStats {
    this.cleanupExpiredRequests();

    const used = this.requests.length;
    const remaining = Math.max(0, this.maxRequests - used);

    // Calculate when the oldest request will expire
    let windowResetMs = 0;
    if (this.requests.length > 0) {
      const oldestRequest = this.requests[0]!;
      windowResetMs = this.windowMs - (Date.now() - oldestRequest);
    }

    return {
      used,
      remaining,
      windowResetMs: Math.max(0, windowResetMs),
    };
  }

  /**
   * Check if we're near the rate limit
   * @param threshold - Fraction of limit (0-1), e.g., 0.8 for 80%
   */
  isNearLimit(threshold: number): boolean {
    this.cleanupExpiredRequests();
    const usedFraction = this.requests.length / this.maxRequests;
    return usedFraction >= threshold;
  }

  /**
   * Reset all tracked requests
   */
  reset(): void {
    this.requests = [];
    this.lastRequestTime = 0;
  }

  /**
   * Remove requests older than the window
   */
  private cleanupExpiredRequests(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    this.requests = this.requests.filter((timestamp) => timestamp > cutoff);
  }
}

// Global rate limiter instance for Bluesky API
// Conservative: 2500 requests per 5 minutes (actual limit is 3000)
// Minimum 50ms delay between requests
let globalRateLimiter: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!globalRateLimiter) {
    globalRateLimiter = new RateLimiter({
      maxRequests: 2500,
      windowMs: 5 * 60 * 1000, // 5 minutes
      minDelayMs: 50,
    });
  }
  return globalRateLimiter;
}

export function resetRateLimiter(): void {
  globalRateLimiter = null;
}
