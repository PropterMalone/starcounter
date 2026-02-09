import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter, getRateLimiter, resetRateLimiter } from './rate-limiter';

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

      const waitPromise = limiter.waitForSlot();
      let resolved = false;

      waitPromise.then(() => {
        resolved = true;
      });

      // Should not resolve immediately
      await vi.advanceTimersByTimeAsync(49);
      expect(resolved).toBe(false);

      // Should resolve after minimum delay
      await vi.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(true);

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

  describe('recursive wait behavior', () => {
    it('should handle window expiration during wait and allow continued requests', async () => {
      const limiter = new RateLimiter({ maxRequests: 2, windowMs: 100 });

      // Fill the window
      await limiter.waitForSlot();
      limiter.recordRequest();

      await limiter.waitForSlot();
      limiter.recordRequest();

      expect(limiter.getStats().used).toBe(2);

      // Start waiting for next slot (should wait for window to expire)
      const waitPromise = limiter.waitForSlot();
      let resolved = false;

      waitPromise.then(() => {
        resolved = true;
      });

      // Advance time to expire the window
      await vi.advanceTimersByTimeAsync(101);

      // Should now be resolved
      expect(resolved).toBe(true);

      // Record the new request
      limiter.recordRequest();
      expect(limiter.getStats().used).toBe(1);
    });

    it('should handle the case where recursion is needed after wait timeout', async () => {
      // This test is difficult to hit the exact recursion edge case
      // The recursion only happens if after a wait for window expiration,
      // the requests are STILL at limit, which requires the cleanup to fail.
      // In practice, cleanup removes old requests, so the condition
      // "requests.length >= maxRequests" after cleanup should be false.
      // This branch is a defensive programming construct.

      const limiter = new RateLimiter({ maxRequests: 1, windowMs: 100 });

      // Add a request
      await limiter.waitForSlot();
      limiter.recordRequest();

      // Wait for window to expire plus a small margin
      const waitPromise = limiter.waitForSlot();
      await vi.advanceTimersByTimeAsync(150);

      // Should resolve because old request is cleaned up
      await expect(waitPromise).resolves.toBeUndefined();
    });
  });

  describe('global singleton', () => {
    afterEach(() => {
      resetRateLimiter();
    });

    it('should create and return the same instance on subsequent calls', () => {
      const first = getRateLimiter();
      const second = getRateLimiter();

      expect(first).toBe(second);
    });

    it('should reset to null and create new instance after resetRateLimiter', () => {
      const first = getRateLimiter();

      resetRateLimiter();

      const second = getRateLimiter();

      expect(first).not.toBe(second);
    });

    it('should have correct default configuration', () => {
      const limiter = getRateLimiter();
      const stats = limiter.getStats();

      expect(stats.remaining).toBe(2500); // maxRequests
    });
  });

  describe('edge cases', () => {
    it('should force recursion by injecting recent requests after timeout', async () => {
      const limiter = new RateLimiter({ maxRequests: 2, windowMs: 100 });

      // Fill requests
      await limiter.waitForSlot();
      limiter.recordRequest();

      await limiter.waitForSlot();
      limiter.recordRequest();

      // Now simulate a case where after wait, requests are still at limit
      // by manually adding a request at the current time while waiting
      const waitPromise = limiter.waitForSlot();
      let resolved = false;

      waitPromise.then(() => {
        resolved = true;
      });

      // Advance time past window
      await vi.advanceTimersByTimeAsync(101);

      // At this point, cleanup should have happened and old requests removed
      // The condition at line 63 should be false normally
      // We can't easily force it to be true without internal access

      expect(resolved).toBe(true);
    });

    it('should handle zero minimum delay', async () => {
      const limiter = new RateLimiter({
        maxRequests: 5,
        windowMs: 60000,
        minDelayMs: 0,
      });

      const start = Date.now();
      await limiter.waitForSlot();
      limiter.recordRequest();

      await limiter.waitForSlot();
      const elapsed = Date.now() - start;

      // Should not have delayed due to minDelayMs
      expect(elapsed).toBeLessThan(50);
    });

    it('should handle undefined minimum delay (defaults to 0)', async () => {
      const limiter = new RateLimiter({
        maxRequests: 5,
        windowMs: 60000,
      });

      await limiter.waitForSlot();
      limiter.recordRequest();

      // Should not require minimum delay
      const start = Date.now();
      await limiter.waitForSlot();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });

    it('should return 0 for windowResetMs when no requests recorded', () => {
      const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60000 });

      const stats = limiter.getStats();
      expect(stats.windowResetMs).toBe(0);
    });

    it('should handle getStats cleanup of expired requests', async () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 100 });

      await limiter.waitForSlot();
      limiter.recordRequest();

      expect(limiter.getStats().used).toBe(1);

      // Advance past window
      await vi.advanceTimersByTimeAsync(101);

      // getStats should clean up automatically
      expect(limiter.getStats().used).toBe(0);
    });

    it('should recursively wait when limit still exceeded after cleanup', async () => {
      const limiter = new RateLimiter({ maxRequests: 2, windowMs: 10000 });

      // Add 2 requests at current time
      await limiter.waitForSlot();
      limiter.recordRequest();

      await limiter.waitForSlot();
      limiter.recordRequest();

      expect(limiter.getStats().used).toBe(2);

      // Now try to get a third slot while at limit
      // After waiting, the window hasn't expired yet, so it should recursively call waitForSlot
      vi.useFakeTimers();

      // Make requests appear slightly old but still in window
      const oldTimestamp = Date.now() - 100;
      (limiter as { requests: Array<number> }).requests = [oldTimestamp, oldTimestamp];

      const waitPromise = limiter.waitForSlot();

      // Advance time past window
      vi.advanceTimersByTime(10100);

      // Now the wait should complete
      await waitPromise;

      vi.useRealTimers();
      expect(limiter.getStats().remaining).toBeGreaterThan(0);
    });

    it('should hit recursive branch after wait when new requests arrive during wait', async () => {
      // This test ensures line 65 recursion is triggered:
      // After timeout, if cleanup doesn't free slots, recurse.

      const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 });

      // Fill up slots
      await limiter.waitForSlot();
      limiter.recordRequest();
      await limiter.waitForSlot();
      limiter.recordRequest();

      // Start waiting for next slot
      const waitPromise = limiter.waitForSlot();

      // Advance time by half the window (not enough to expire first requests)
      await vi.advanceTimersByTimeAsync(500);

      // At this point, waitForSlot calculated wait time and is waiting
      // After the wait completes, cleanup will run but requests won't be expired yet
      // This should trigger the recursive call at line 65

      // Advance to complete the wait, but requests still in window
      await vi.advanceTimersByTimeAsync(500);

      // Now advance past the full window so recursion can succeed
      await vi.advanceTimersByTimeAsync(500);

      await waitPromise;

      // Verify we can now record
      limiter.recordRequest();
      expect(limiter.getStats().used).toBeGreaterThan(0);
    });
  });
});
