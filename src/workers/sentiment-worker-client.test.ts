// pattern: Imperative Shell
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SentimentWorkerClient, createSentimentWorkerClient } from './sentiment-worker-client';
import type { SentimentResult } from '../lib/sentiment-analyzer';

describe('SentimentWorkerClient', () => {
  let client: SentimentWorkerClient;
  let mockWorker: {
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((error: ErrorEvent) => void) | null;
  };

  beforeEach(() => {
    mockWorker = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };

    client = new SentimentWorkerClient(mockWorker as unknown as Worker);
  });

  afterEach(() => {
    // Clear pending requests map directly to avoid unhandled rejections
    // during cleanup when tests don't await their promises
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).pendingRequests.clear();
    client.terminate();
  });

  describe('analyze', () => {
    it('should send message to worker and receive result', async () => {
      const expectedResult: SentimentResult = {
        score: 0.95,
        comparative: 0.95,
        classification: 'Positive',
        strength: 'Strong',
        positiveWords: [],
        negativeWords: [],
      };

      const analyzePromise = client.analyze('Great movie!');

      // Simulate worker response
      const messageEvent = {
        data: { id: 1, result: expectedResult },
      } as MessageEvent;
      mockWorker.onmessage?.(messageEvent);

      const result = await analyzePromise;

      expect(mockWorker.postMessage).toHaveBeenCalledWith({ id: 1, text: 'Great movie!' });
      expect(result).toEqual(expectedResult);
    });

    it('should handle multiple concurrent requests', async () => {
      const result1: SentimentResult = {
        score: 0.9,
        comparative: 0.9,
        classification: 'Positive',
        strength: 'Strong',
        positiveWords: [],
        negativeWords: [],
      };
      const result2: SentimentResult = {
        score: -0.8,
        comparative: -0.8,
        classification: 'Negative',
        strength: 'Moderate',
        positiveWords: [],
        negativeWords: [],
      };

      const promise1 = client.analyze('Good');
      const promise2 = client.analyze('Bad');

      // Simulate out-of-order responses
      mockWorker.onmessage?.({ data: { id: 2, result: result2 } } as MessageEvent);
      mockWorker.onmessage?.({ data: { id: 1, result: result1 } } as MessageEvent);

      const [r1, r2] = await Promise.all([promise1, promise2]);

      expect(r1).toEqual(result1);
      expect(r2).toEqual(result2);
    });

    it('should reject when worker returns error', async () => {
      const analyzePromise = client.analyze('test');

      mockWorker.onmessage?.({ data: { id: 1, error: 'Inference failed' } } as MessageEvent);

      await expect(analyzePromise).rejects.toThrow('Inference failed');
    });

    it('should handle worker errors', async () => {
      const analyzePromise = client.analyze('test');

      const errorEvent = new ErrorEvent('error', { message: 'Worker crashed' });
      mockWorker.onerror?.(errorEvent);

      await expect(analyzePromise).rejects.toThrow('Worker crashed');
    });

    it('should increment request ids', async () => {
      client.analyze('first');
      client.analyze('second');
      client.analyze('third');

      expect(mockWorker.postMessage).toHaveBeenNthCalledWith(1, { id: 1, text: 'first' });
      expect(mockWorker.postMessage).toHaveBeenNthCalledWith(2, { id: 2, text: 'second' });
      expect(mockWorker.postMessage).toHaveBeenNthCalledWith(3, { id: 3, text: 'third' });
    });
  });

  describe('isReady', () => {
    it('should initially return false', () => {
      expect(client.isReady()).toBe(false);
    });

    it('should return true after model loaded message', () => {
      mockWorker.onmessage?.({ data: { type: 'model-loaded' } } as MessageEvent);

      expect(client.isReady()).toBe(true);
    });
  });

  describe('isLoading', () => {
    it('should initially return false', () => {
      expect(client.isLoading()).toBe(false);
    });

    it('should return true when model is loading', () => {
      mockWorker.onmessage?.({ data: { type: 'model-loading' } } as MessageEvent);

      expect(client.isLoading()).toBe(true);
    });

    it('should return false after model loaded', () => {
      mockWorker.onmessage?.({ data: { type: 'model-loading' } } as MessageEvent);
      mockWorker.onmessage?.({ data: { type: 'model-loaded' } } as MessageEvent);

      expect(client.isLoading()).toBe(false);
    });
  });

  describe('onProgress', () => {
    it('should call progress callback with download progress', () => {
      const progressCallback = vi.fn();
      client.onProgress(progressCallback);

      mockWorker.onmessage?.({
        data: { type: 'progress', progress: 0.5 },
      } as MessageEvent);

      expect(progressCallback).toHaveBeenCalledWith(0.5);
    });

    it('should support multiple progress callbacks', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      client.onProgress(callback1);
      client.onProgress(callback2);

      mockWorker.onmessage?.({
        data: { type: 'progress', progress: 0.75 },
      } as MessageEvent);

      expect(callback1).toHaveBeenCalledWith(0.75);
      expect(callback2).toHaveBeenCalledWith(0.75);
    });
  });

  describe('terminate', () => {
    it('should call worker.terminate', () => {
      client.terminate();

      expect(mockWorker.terminate).toHaveBeenCalled();
    });

    it('should reject pending requests on terminate', async () => {
      const promise = client.analyze('test');

      client.terminate();

      await expect(promise).rejects.toThrow('Worker terminated');
    });

    it('should reject analyze calls after termination', async () => {
      client.terminate();

      await expect(client.analyze('test')).rejects.toThrow('Worker terminated');
    });
  });

  describe('message handling edge cases', () => {
    it('should ignore messages with unknown request IDs', () => {
      // Send message with ID that was never requested
      expect(() => {
        mockWorker.onmessage?.({
          data: { id: 999, result: { score: 0.5 } },
        } as MessageEvent);
      }).not.toThrow();
    });
  });

  describe('isAgreement', () => {
    it('should return true for positive sentiment', async () => {
      const result: SentimentResult = {
        score: 0.9,
        comparative: 0.9,
        classification: 'Positive',
        strength: 'Strong',
        positiveWords: [],
        negativeWords: [],
      };

      const promise = client.isAgreement('I agree');
      mockWorker.onmessage?.({ data: { id: 1, result } } as MessageEvent);

      expect(await promise).toBe(true);
    });

    it('should return false for negative sentiment', async () => {
      const result: SentimentResult = {
        score: -0.85,
        comparative: -0.85,
        classification: 'Negative',
        strength: 'Moderate',
        positiveWords: [],
        negativeWords: [],
      };

      const promise = client.isAgreement('I disagree');
      mockWorker.onmessage?.({ data: { id: 1, result } } as MessageEvent);

      expect(await promise).toBe(false);
    });
  });
});

describe('createSentimentWorkerClient', () => {
  it('should be a function', () => {
    expect(typeof createSentimentWorkerClient).toBe('function');
  });

  it('should create and return a SentimentWorkerClient instance', () => {
    // Create a proper constructor function
    const MockWorker = vi.fn(function (this: Worker) {
      this.postMessage = vi.fn();
      this.terminate = vi.fn();
      this.onmessage = null;
      this.onerror = null;
    } as unknown as new (url: string | URL, options?: WorkerOptions) => Worker);

    // Mock the Worker constructor globally
    globalThis.Worker = MockWorker as unknown as typeof Worker;

    const workerUrl = 'test-worker.js';
    const client = createSentimentWorkerClient(workerUrl);

    expect(MockWorker).toHaveBeenCalledWith(workerUrl, { type: 'module' });
    expect(client).toBeInstanceOf(SentimentWorkerClient);

    client.terminate();
  });
});
