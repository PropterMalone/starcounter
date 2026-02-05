// pattern: Functional Core
import { describe, it, expect, vi } from 'vitest';

// Mock the Transformers module before importing
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(vi.fn()),
}));

import { createSentimentAnalyzer } from './sentiment-factory';
import { SentimentAnalyzer } from './sentiment-analyzer';
import { TransformersAnalyzer } from './transformers-analyzer';

describe('createSentimentAnalyzer', () => {
  it('should return SentimentAnalyzer when advanced is false', () => {
    const analyzer = createSentimentAnalyzer(false);

    expect(analyzer).toBeInstanceOf(SentimentAnalyzer);
  });

  it('should return TransformersAnalyzer when advanced is true', () => {
    const analyzer = createSentimentAnalyzer(true);

    expect(analyzer).toBeInstanceOf(TransformersAnalyzer);
  });

  it('should return basic analyzer by default', () => {
    const analyzer = createSentimentAnalyzer();

    expect(analyzer).toBeInstanceOf(SentimentAnalyzer);
  });
});

describe('SentimentAnalyzerInterface', () => {
  it('should define analyze method', () => {
    const analyzer = createSentimentAnalyzer(false);

    expect(typeof analyzer.analyze).toBe('function');
  });

  it('should define isAgreement method', () => {
    const analyzer = createSentimentAnalyzer(false);

    expect(typeof analyzer.isAgreement).toBe('function');
  });
});
