// pattern: Functional Core
import { SentimentAnalyzer, type SentimentResult } from './sentiment-analyzer';
import { TransformersAnalyzer } from './transformers-analyzer';

/**
 * Common interface for sentiment analyzers (basic and advanced).
 * Basic analyzer is synchronous, advanced is async.
 */
export type SentimentAnalyzerInterface = {
  analyze(text: string): SentimentResult | Promise<SentimentResult>;
  isAgreement(text: string): boolean | Promise<boolean>;
};

/**
 * Factory function to create sentiment analyzer.
 * Returns basic keyword-based analyzer or advanced ML-based analyzer.
 *
 * @param advanced - If true, returns TransformersAnalyzer (ML-based)
 * @returns SentimentAnalyzer or TransformersAnalyzer
 */
export function createSentimentAnalyzer(
  advanced = false
): SentimentAnalyzer | TransformersAnalyzer {
  if (advanced) {
    return new TransformersAnalyzer();
  }
  return new SentimentAnalyzer();
}
