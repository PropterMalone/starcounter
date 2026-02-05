import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('token bucket algorithm', () => {
    it('should allow requests up to the limit', async () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000 });

      // Should allow 5 requests without waiting
      for (let i = 0; i < 5; i++) {
        await limiter.waitForSlot();
        limiter.recordRequest();
      }

      const stats = limiter.getStats();
      expect(stats.used).toBe(5);
      expect(stats.remaining).toBe(0);
    });

    it('should block when limit is reached', async () => {
      const limiter = new RateLimiter({ maxRequests: 3, windowMs: 60000 });

      // Use all 3 slots
      for (let i = 0; i < 3; i++) {
        await limiter.waitForSlot();
        limiter.recordRequest();
      }

      // 4th request should wait
      const waitPromise = limiter.waitForSlot();

      // Should not resolve immediately
      let resolved = false;
      waitPromise.then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(100);
      expect(resolved).toBe(false);

      // After window expires, should resolve
      await vi.advanceTimersByTimeAsync(60000);
      expect(resolved).toBe(true);
    });

    it('should respect minimum delay between requests', async () => {
      const limiter = new RateLimiter({
        maxRequests: 100,
        windowMs: 60000,
        minDelayMs: 50,
      });

      const start = Date.now();
      await limiter.waitForSlot();
      limiter.recordRequest();

      await limiter.waitForSlot();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(50);
    });

    it('should remove expired requests from window', async () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000 });

      // Make 3 requests
      for (let i = 0; i < 3; i++) {
        await limiter.waitForSlot();
        limiter.recordRequest();
      }

      expect(limiter.getStats().used).toBe(3);

      // Advance time past window
      await vi.advanceTimersByTimeAsync(61000);

      // Old requests should be removed
      expect(limiter.getStats().used).toBe(0);
      expect(limiter.getStats().remaining).toBe(5);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', async () => {
      const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60000 });

      // Make 3 requests
      for (let i = 0; i < 3; i++) {
        await limiter.waitForSlot();
        limiter.recordRequest();
      }

      const stats = limiter.getStats();
      expect(stats.used).toBe(3);
      expect(stats.remaining).toBe(7);
      expect(stats.windowResetMs).toBeGreaterThan(0);
    });
  });

  describe('isNearLimit', () => {
    it('should detect when approaching limit', async () => {
      const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60000 });

      expect(limiter.isNearLimit(0.5)).toBe(false);

      // Use 6 of 10 slots (60%)
      for (let i = 0; i < 6; i++) {
        await limiter.waitForSlot();
        limiter.recordRequest();
      }

      expect(limiter.isNearLimit(0.5)).toBe(true);
      expect(limiter.isNearLimit(0.7)).toBe(false);
    });
  });

  describe('reset', () => {
    it('should clear all tracked requests', async () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000 });

      // Use all slots
      for (let i = 0; i < 5; i++) {
        await limiter.waitForSlot();
        limiter.recordRequest();
      }

      expect(limiter.getStats().used).toBe(5);

      limiter.reset();

      expect(limiter.getStats().used).toBe(0);
      expect(limiter.getStats().remaining).toBe(5);
    });
  });
});
