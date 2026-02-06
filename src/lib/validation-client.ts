// pattern: Imperative Shell
import type { MediaMention } from './mention-extractor';

export type ValidatedMention = MediaMention & {
  validated?: boolean;
  validationConfidence?: 'high' | 'medium' | 'low';
  validatedTitle?: string;
};

export type ValidationProgress = {
  readonly total: number;
  readonly completed: number;
  readonly currentTitle: string;
};

export type ValidationClientOptions = {
  readonly apiUrl: string;
  readonly onProgress?: (progress: ValidationProgress) => void;
  readonly batchSize?: number;
  readonly batchDelayMs?: number;
};

export type ValidationResponse = {
  readonly validated: boolean;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly title: string;
  readonly artist?: string;
  readonly source?: 'tmdb' | 'musicbrainz';
  readonly metadata?: Record<string, unknown>;
};

/**
 * Client-side wrapper for validation API
 * Handles batching and progress reporting
 */
export class ValidationClient {
  private options: Required<ValidationClientOptions>;

  constructor(options: ValidationClientOptions) {
    this.options = {
      batchSize: 50, // Increased from 10 for better throughput
      batchDelayMs: 50, // Reduced from 100ms
      onProgress: () => {},
      ...options,
    };
  }

  /**
   * Validate multiple mentions with progress reporting
   */
  async validateMentions(mentions: MediaMention[]): Promise<ValidatedMention[]> {
    const validated: ValidatedMention[] = [];
    const total = mentions.length;

    // Process in batches to avoid overwhelming the API
    for (let i = 0; i < mentions.length; i += this.options.batchSize) {
      const batch = mentions.slice(i, i + this.options.batchSize);

      const batchResults = await Promise.all(batch.map((mention) => this.validateSingle(mention)));

      validated.push(...batchResults);

      // Report progress
      this.options.onProgress({
        total,
        completed: validated.length,
        currentTitle: batch[batch.length - 1]?.title ?? '',
      });

      // Delay between batches (except last)
      if (i + this.options.batchSize < mentions.length) {
        await new Promise((resolve) => setTimeout(resolve, this.options.batchDelayMs));
      }
    }

    return validated;
  }

  /**
   * Validate a single mention
   */
  private async validateSingle(mention: MediaMention): Promise<ValidatedMention> {
    try {
      const response = await fetch(this.options.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: mention.title,
          mediaType: mention.mediaType,
        }),
      });

      if (!response.ok) {
        // Validation failed, return original mention
        return mention;
      }

      const result = (await response.json()) as ValidationResponse;

      // Merge validation result with original mention
      return {
        ...mention,
        validated: result.validated,
        validationConfidence: result.confidence,
        validatedTitle: result.title,
        artist: result.artist || mention.artist,
      };
    } catch {
      // Network error, return original mention
      return mention;
    }
  }
}
