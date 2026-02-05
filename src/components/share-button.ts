// pattern: Imperative Shell
import type { MentionCount } from '../types';
import { toShareableResults, encodeResults } from '../lib/url-encoder';

/**
 * Share button component for copying shareable URLs
 * Generates compressed URL with analysis results
 */
export class ShareButton {
  private results: MentionCount[] | null = null;
  private feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private button: HTMLButtonElement,
    private feedback: HTMLElement,
    private feedbackText: HTMLElement
  ) {
    this.attachEventListeners();
  }

  /**
   * Attach click handler to button
   */
  private attachEventListeners(): void {
    this.button.addEventListener('click', () => {
      this.handleShare();
    });
  }

  /**
   * Set results to share
   */
  setResults(results: MentionCount[]): void {
    this.results = results;
  }

  /**
   * Handle share button click
   */
  private async handleShare(): Promise<void> {
    if (!this.results) {
      return;
    }

    try {
      const url = this.generateShareUrl();
      await navigator.clipboard.writeText(url);
      this.showFeedback('Link copied to clipboard!');
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      this.showFeedback('Failed to copy link');
    }
  }

  /**
   * Generate shareable URL with encoded results
   */
  private generateShareUrl(): string {
    if (!this.results) {
      throw new Error('No results to share');
    }

    const shareable = toShareableResults(this.results);
    const encoded = encodeResults(shareable);

    // Use current page URL as base
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    return `${baseUrl}?r=${encoded}`;
  }

  /**
   * Show feedback message temporarily
   */
  private showFeedback(message: string): void {
    // Clear any existing timeout
    if (this.feedbackTimeout) {
      clearTimeout(this.feedbackTimeout);
    }

    this.feedbackText.textContent = message;
    this.feedback.style.display = 'block';

    // Auto-hide after 3 seconds
    this.feedbackTimeout = setTimeout(() => {
      this.feedback.style.display = 'none';
    }, 3000);
  }
}
