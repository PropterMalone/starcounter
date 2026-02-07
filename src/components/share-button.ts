// pattern: Imperative Shell
import type { MentionCount, PostView } from '../types';
import { toStoredPost } from '../lib/share-types';

/**
 * State snapshot captured at share time.
 * Includes drill-down posts and user tweaks so shared links preserve full functionality.
 */
export type ShareState = {
  readonly mentionCounts: MentionCount[];
  readonly uncategorizedPosts: PostView[];
  readonly excludedCategories: string[];
  readonly manualAssignments: Record<string, string>;
  readonly originalPost: PostView | null;
  readonly postCount: number;
};

/**
 * Share button component for copying shareable URLs.
 * POSTs full results to D1-backed API so shared links include drill-down data.
 */
export class ShareButton {
  private stateProvider: (() => ShareState) | null = null;
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
   * Set a provider function that returns current app state on demand.
   * Called at share time so tweaks (exclusions, reassignments) are captured.
   */
  setStateProvider(provider: () => ShareState): void {
    this.stateProvider = provider;
  }

  /**
   * Handle share button click — upload to D1 and copy link
   */
  private async handleShare(): Promise<void> {
    if (!this.stateProvider) {
      return;
    }

    const state = this.stateProvider();
    if (state.mentionCounts.length === 0) {
      return;
    }

    // Disable button during upload
    this.button.disabled = true;
    this.showFeedback('Uploading...');

    try {
      const sharedData = {
        mentionCounts: state.mentionCounts.map((mc) => ({
          mention: mc.mention,
          count: mc.count,
          posts: mc.posts.map(toStoredPost),
        })),
        uncategorizedPosts: state.uncategorizedPosts.map(toStoredPost),
        excludedCategories: state.excludedCategories,
        manualAssignments: state.manualAssignments,
        originalPost: state.originalPost ? toStoredPost(state.originalPost) : null,
        postCount: state.postCount,
        timestamp: Date.now(),
      };

      const response = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sharedData),
      });

      if (!response.ok) {
        throw new Error(`upload failed: ${response.status}`);
      }

      const { id } = await response.json();
      const baseUrl = `${window.location.origin}${window.location.pathname}`;
      const url = `${baseUrl}?s=${id}`;

      await navigator.clipboard.writeText(url);
      this.showFeedback('Link copied to clipboard!');
    } catch (error) {
      console.error('Failed to share results:', error);
      this.showFeedback('Failed to share results');
    } finally {
      this.button.disabled = false;
    }
  }

  /**
   * Show feedback message temporarily with smooth fadeout
   */
  private showFeedback(message: string): void {
    // Clear any existing timeout
    if (this.feedbackTimeout) {
      clearTimeout(this.feedbackTimeout);
    }

    // Reset state: remove fadeout class and show
    this.feedback.classList.remove('fade-out');
    this.feedbackText.textContent = message;
    this.feedback.style.display = 'block';

    // Start fadeout after 2.5 seconds (animation takes 0.3s, totaling ~3s visible)
    this.feedbackTimeout = setTimeout(() => {
      this.feedback.classList.add('fade-out');

      // Hide after fadeout animation completes
      setTimeout(() => {
        this.feedback.style.display = 'none';
        this.feedback.classList.remove('fade-out');
      }, 300);
    }, 2500);
  }
}
