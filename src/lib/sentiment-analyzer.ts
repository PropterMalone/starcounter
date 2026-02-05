// pattern: Functional Core
import Sentiment = require('sentiment');

export interface SentimentResult {
  score: number;
  comparative: number;
  classification: 'Positive' | 'Negative' | 'Neutral';
  strength: 'Strong' | 'Moderate' | 'Weak';
  positiveWords: string[];
  negativeWords: string[];
}

const CUSTOM_WORDS = {
  // Agreement keywords (positive)
  agree: 3,
  agreed: 3,
  agreeing: 3,
  exactly: 2,
  absolutely: 3,
  yes: 2,
  correct: 2,
  right: 2,
  indeed: 2,
  definitely: 2,
  surely: 2,
  true: 2,

  // Disagreement keywords (negative)
  disagree: -3,
  disagreed: -3,
  disagreeing: -3,
  no: -1,
  nope: -2,
  wrong: -2,
  incorrect: -2,
  actually: -1,
  however: -1,
  but: -1,
};

/**
 * Sentiment analyzer using Sentiment.js with custom agreement/disagreement keywords
 */
export class SentimentAnalyzer {
  private sentiment: Sentiment;

  constructor() {
    this.sentiment = new Sentiment();
  }

  /**
   * Analyze text for sentiment
   * Returns classification, score, and strength
   */
  analyze(text: string): SentimentResult {
    const result = this.sentiment.analyze(text, { extras: CUSTOM_WORDS });

    // Classify based on comparative score
    let classification: 'Positive' | 'Negative' | 'Neutral';
    if (result.comparative >= 0.05) {
      classification = 'Positive';
    } else if (result.comparative <= -0.05) {
      classification = 'Negative';
    } else {
      classification = 'Neutral';
    }

    // Determine strength
    const absComparative = Math.abs(result.comparative);
    let strength: 'Strong' | 'Moderate' | 'Weak';
    if (absComparative > 0.5) {
      strength = 'Strong';
    } else if (absComparative > 0.05) {
      strength = 'Moderate';
    } else {
      strength = 'Weak';
    }

    return {
      score: result.score,
      comparative: result.comparative,
      classification,
      strength,
      positiveWords: result.positive,
      negativeWords: result.negative,
    };
  }

  /**
   * Helper: Check if text expresses agreement
   * Returns true for positive sentiment, false for negative or neutral
   */
  isAgreement(text: string): boolean {
    const result = this.analyze(text);
    return result.classification === 'Positive';
  }
}
