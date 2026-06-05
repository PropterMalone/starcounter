// pattern: Functional Core
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to properly hoist the mock function
const { mockInference } = vi.hoisted(() => ({
  mockInference: vi.fn(),
}));

// Mock the pipeline
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(mockInference),
}));

// Import the module under test after mocking
import { TransformersAnalyzer } from './transformers-analyzer';
import { pipeline } from '@xenova/transformers';

describe('TransformersAnalyzer', () => {
  let analyzer: TransformersAnalyzer;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pipeline).mockResolvedValue(
      mockInference as unknown as Awaited<ReturnType<typeof pipeline>>
    );
    analyzer = new TransformersAnalyzer();
  });

  describe('initialize', () => {
    it('should load the pipeline with correct parameters', async () => {
      await analyzer.initialize();

      expect(pipeline).toHaveBeenCalledWith(
        'sentiment-analysis',
        'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
        { quantized: true }
      );
    });

    it('should only initialize once', async () => {
      await analyzer.initialize();
      await analyzer.initialize();

      expect(pipeline).toHaveBeenCalledTimes(1);
    });

    it('should report loading state', () => {
      expect(analyzer.isLoading()).toBe(false);
    });

    it('should report ready state after initialization', async () => {
      expect(analyzer.isReady()).toBe(false);
      await analyzer.initialize();
      expect(analyzer.isReady()).toBe(true);
    });

    it('should return existing loading promise on concurrent calls', async () => {
      // Delay the pipeline resolution
      let resolvePipeline: () => void;
      vi.mocked(pipeline).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePipeline = () =>
              resolve(mockInference as unknown as Awaited<ReturnType<typeof pipeline>>);
          })
      );

      // Call initialize twice concurrently
      const promise1 = analyzer.initialize();
      const promise2 = analyzer.initialize();

      // Both should be the same promise
      expect(analyzer.isLoading()).toBe(true);

      // Resolve the pipeline
      resolvePipeline!();

      await Promise.all([promise1, promise2]);

      // Should only have called pipeline once
      expect(pipeline).toHaveBeenCalledTimes(1);
    });
  });

  describe('analyze', () => {
    it('should auto-initialize if not ready', async () => {
      mockInference.mockResolvedValue([{ label: 'POSITIVE', score: 0.95 }]);

      await analyzer.analyze('This is great!');

      expect(pipeline).toHaveBeenCalled();
    });

    it('should return positive classification for POSITIVE label', async () => {
      mockInference.mockResolvedValue([{ label: 'POSITIVE', score: 0.95 }]);

      const result = await analyzer.analyze('This is great!');

      expect(result.classification).toBe('Positive');
      expect(result.score).toBeGreaterThan(0);
    });

    it('should return negative classification for NEGATIVE label', async () => {
      mockInference.mockResolvedValue([{ label: 'NEGATIVE', score: 0.92 }]);

      const result = await analyzer.analyze('This is terrible!');

      expect(result.classification).toBe('Negative');
      expect(result.score).toBeLessThan(0);
    });

    it('should return neutral for low confidence scores', async () => {
      mockInference.mockResolvedValue([{ label: 'POSITIVE', score: 0.52 }]);

      const result = await analyzer.analyze('ok');

      expect(result.classification).toBe('Neutral');
    });

    it('should return Strong strength for high confidence', async () => {
      mockInference.mockResolvedValue([{ label: 'POSITIVE', score: 0.98 }]);

      const result = await analyzer.analyze('Absolutely amazing!');

      expect(result.strength).toBe('Strong');
    });

    it('should return Moderate strength for medium confidence', async () => {
      mockInference.mockResolvedValue([{ label: 'POSITIVE', score: 0.75 }]);

      const result = await analyzer.analyze('Pretty good');

      expect(result.strength).toBe('Moderate');
    });

    it('should return Weak strength for low confidence', async () => {
      mockInference.mockResolvedValue([{ label: 'POSITIVE', score: 0.55 }]);

      const result = await analyzer.analyze('meh');

      expect(result.strength).toBe('Weak');
    });

    it('should return SentimentResult interface', async () => {
      mockInference.mockResolvedValue([{ label: 'POSITIVE', score: 0.85 }]);

      const result = await analyzer.analyze('Great movie!');

      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('comparative');
      expect(result).toHaveProperty('classification');
      expect(result).toHaveProperty('strength');
      expect(result).toHaveProperty('positiveWords');
      expect(result).toHaveProperty('negativeWords');
    });

    it('should handle empty text', async () => {
      mockInference.mockResolvedValue([{ label: 'POSITIVE', score: 0.5 }]);

      const result = await analyzer.analyze('');

      expect(result.classification).toBe('Neutral');
    });

    it('should handle empty result array', async () => {
      mockInference.mockResolvedValue([]);

      const result = await analyzer.analyze('test');

      expect(result.classification).toBe('Neutral');
      expect(result.score).toBe(0);
      expect(result.strength).toBe('Weak');
    });

    it('should handle very long text', async () => {
      const longText = 'This is great! '.repeat(100);
      mockInference.mockResolvedValue([{ label: 'POSITIVE', score: 0.92 }]);

      const result = await analyzer.analyze(longText);

      expect(result.classification).toBe('Positive');
    });

    it('should handle special characters', async () => {
      mockInference.mockResolvedValue([{ label: 'POSITIVE', score: 0.88 }]);

      const result = await analyzer.analyze('🎬 Amazing film!! 🔥🔥🔥');

      expect(result.classification).toBe('Positive');
    });
  });

  describe('isAgreement', () => {
    it('should return true for positive sentiment', async () => {
      mockInference.mockResolvedValue([{ label: 'POSITIVE', score: 0.9 }]);

      const result = await analyzer.isAgreement('I completely agree!');

      expect(result).toBe(true);
    });

    it('should return false for negative sentiment', async () => {
      mockInference.mockResolvedValue([{ label: 'NEGATIVE', score: 0.85 }]);

      const result = await analyzer.isAgreement('I strongly disagree');

      expect(result).toBe(false);
    });

    it('should return false for neutral sentiment', async () => {
      mockInference.mockResolvedValue([{ label: 'POSITIVE', score: 0.52 }]);

      const result = await analyzer.isAgreement('maybe');

      expect(result).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should throw if pipeline fails to load', async () => {
      vi.mocked(pipeline).mockRejectedValue(new Error('Network error'));

      await expect(analyzer.initialize()).rejects.toThrow('Network error');
    });

    it('should throw if inference fails', async () => {
      mockInference.mockRejectedValue(new Error('Inference failed'));
      await analyzer.initialize();

      await expect(analyzer.analyze('test')).rejects.toThrow('Inference failed');
    });
  });
});
