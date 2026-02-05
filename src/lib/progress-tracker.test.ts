import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProgressTracker } from './progress-tracker';

describe('ProgressTracker', () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    tracker = new ProgressTracker();
  });

  describe('event emission', () => {
    it('should emit fetching event with progress data', () => {
      const listener = vi.fn();
      tracker.on('fetching', listener);

      tracker.emit('fetching', { fetched: 10, total: 100 });

      expect(listener).toHaveBeenCalledWith({ fetched: 10, total: 100 });
    });

    it('should emit extracting event', () => {
      const listener = vi.fn();
      tracker.on('extracting', listener);

      tracker.emit('extracting', {});

      expect(listener).toHaveBeenCalledWith({});
    });

    it('should emit counting event', () => {
      const listener = vi.fn();
      tracker.on('counting', listener);

      tracker.emit('counting', {});

      expect(listener).toHaveBeenCalledWith({});
    });

    it('should emit validating event with progress data', () => {
      const listener = vi.fn();
      tracker.on('validating', listener);

      tracker.emit('validating', { validated: 5, total: 20 });

      expect(listener).toHaveBeenCalledWith({ validated: 5, total: 20 });
    });

    it('should emit complete event with results', () => {
      const listener = vi.fn();
      tracker.on('complete', listener);

      const results = {
        mentions: [{ text: 'The Matrix', count: 5 }],
        totalPosts: 100,
      };

      tracker.emit('complete', results);

      expect(listener).toHaveBeenCalledWith(results);
    });

    it('should emit error event', () => {
      const listener = vi.fn();
      tracker.on('error', listener);

      const error = new Error('Test error');
      tracker.emit('error', { error });

      expect(listener).toHaveBeenCalledWith({ error });
    });
  });

  describe('multiple listeners', () => {
    it('should call all registered listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      tracker.on('fetching', listener1);
      tracker.on('fetching', listener2);

      tracker.emit('fetching', { fetched: 5, total: 10 });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeListener', () => {
    it('should remove specific listener', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      tracker.on('fetching', listener1);
      tracker.on('fetching', listener2);

      tracker.off('fetching', listener1);

      tracker.emit('fetching', { fetched: 5, total: 10 });

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should handle removing listener from event with no listeners', () => {
      const listener = vi.fn();

      // Try to remove listener from event that has no listeners
      expect(() => {
        tracker.off('fetching', listener);
      }).not.toThrow();
    });

    it('should emit event even when no listeners registered', () => {
      // This should not throw
      expect(() => {
        tracker.emit('fetching', { fetched: 5, total: 10 });
      }).not.toThrow();
    });
  });

  describe('heartbeat detection', () => {
    it('should detect stalls when no events emitted', () => {
      vi.useFakeTimers();

      const stallCallback = vi.fn();
      tracker.startHeartbeat(1000, stallCallback);

      // Advance time without emitting events
      vi.advanceTimersByTime(1100);

      expect(stallCallback).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('should not detect stalls when events are emitted regularly', () => {
      vi.useFakeTimers();

      const stallCallback = vi.fn();
      tracker.startHeartbeat(1000, stallCallback);

      // Emit event before timeout
      vi.advanceTimersByTime(500);
      tracker.emit('fetching', { fetched: 10, total: 100 });

      // Advance more time
      vi.advanceTimersByTime(500);
      tracker.emit('fetching', { fetched: 20, total: 100 });

      // Total 1000ms passed, but no stall because events were emitted
      expect(stallCallback).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should stop heartbeat monitoring', () => {
      vi.useFakeTimers();

      const stallCallback = vi.fn();
      tracker.startHeartbeat(1000, stallCallback);
      tracker.stopHeartbeat();

      // Advance time - should not trigger callback
      vi.advanceTimersByTime(1100);

      expect(stallCallback).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('reset', () => {
    it('should remove all listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      tracker.on('fetching', listener1);
      tracker.on('complete', listener2);

      tracker.reset();

      tracker.emit('fetching', { fetched: 5, total: 10 });
      tracker.emit('complete', {});

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });

    it('should stop heartbeat', () => {
      vi.useFakeTimers();

      const stallCallback = vi.fn();
      tracker.startHeartbeat(1000, stallCallback);
      tracker.reset();

      vi.advanceTimersByTime(1100);

      expect(stallCallback).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
