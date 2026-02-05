// pattern: Functional Core
import { pipeline } from '@xenova/transformers';
import type { SentimentResult } from './sentiment-analyzer';

// Callable pipeline function type
type SentimentPipeline = (text: string) => Promise<Array<{ label: string; score: number }>>;
type InferenceResult = Array<{ label: string; score: number }>;

// Thresholds for classification and strength
const NEUTRAL_THRESHOLD = 0.6;
const STRONG_THRESHOLD = 0.9;
const MODERATE_THRESHOLD = 0.7;

/**
 * Advanced sentiment analyzer using Transformers.js with distilbert model.
 * Provides more nuanced sentiment detection than keyword-based approaches.
 * Loads lazily to avoid blocking initial page load (~30MB model).
 */
export class TransformersAnalyzer {
  private pipelineInstance: SentimentPipeline | null = null;
  private loadingPromise: Promise<void> | null = null;

  /**
   * Initialize the Transformers.js pipeline.
   * Downloads and loads the quantized distilbert model (~30MB).
   * Safe to call multiple times - only initializes once.
   */
  async initialize(): Promise<void> {
    if (this.pipelineInstance) {
      return;
    }

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = this.loadPipeline();
    await this.loadingPromise;
  }

  private async loadPipeline(): Promise<void> {
    this.pipelineInstance = (await pipeline(
      'sentiment-analysis',
      'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
      { quantized: true }
    )) as unknown as SentimentPipeline;
  }

  /**
   * Check if the model is currently loading
   */
  isLoading(): boolean {
    return this.loadingPromise !== null && this.pipelineInstance === null;
  }

  /**
   * Check if the model is ready for inference
   */
  isReady(): boolean {
    return this.pipelineInstance !== null;
  }

  /**
   * Analyze text for sentiment using ML model.
   * Auto-initializes if not ready.
   *
   * @param text - Text to analyze
   * @returns SentimentResult compatible with basic analyzer interface
   */
  async analyze(text: string): Promise<SentimentResult> {
    if (!this.pipelineInstance) {
      await this.initialize();
    }

    const result = (await this.pipelineInstance!(text)) as InferenceResult;
    const prediction = result[0];

    if (!prediction) {
      return this.createNeutralResult();
    }

    const { label, score } = prediction;
    const isPositive = label === 'POSITIVE';

    // Classify based on confidence threshold
    let classification: 'Positive' | 'Negative' | 'Neutral';
    if (score < NEUTRAL_THRESHOLD) {
      classification = 'Neutral';
    } else if (isPositive) {
      classification = 'Positive';
    } else {
      classification = 'Negative';
    }

    // Determine strength based on confidence
    let strength: 'Strong' | 'Moderate' | 'Weak';
    if (score >= STRONG_THRESHOLD) {
      strength = 'Strong';
    } else if (score >= MODERATE_THRESHOLD) {
      strength = 'Moderate';
    } else {
      strength = 'Weak';
    }

    // Convert to comparative score (-1 to 1 scale)
    const comparative = isPositive ? score : -score;
    const normalizedScore = classification === 'Neutral' ? 0 : comparative;

    return {
      score: normalizedScore,
      comparative,
      classification,
      strength,
      // ML model doesn't provide word-level analysis
      positiveWords: [],
      negativeWords: [],
    };
  }

  /**
   * Helper: Check if text expresses agreement.
   * Returns true for positive sentiment, false otherwise.
   */
  async isAgreement(text: string): Promise<boolean> {
    const result = await this.analyze(text);
    return result.classification === 'Positive';
  }

  private createNeutralResult(): SentimentResult {
    return {
      score: 0,
      comparative: 0,
      classification: 'Neutral',
      strength: 'Weak',
      positiveWords: [],
      negativeWords: [],
    };
  }
}
