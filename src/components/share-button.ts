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
  private feedbackTimeout: ReturnType<typeof setTimeout> | undefined;

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

      const copied = await this.copyToClipboard(url);
      if (copied) {
        this.showFeedback('Link copied to clipboard!');
      } else {
        this.showFeedbackWithUrl('Link ready (copy it manually):', url);
      }
    } catch (error) {
      console.error('Failed to share results:', error);
      this.showFeedback('Failed to share results');
    } finally {
      this.button.disabled = false;
    }
  }

  /**
   * Try clipboard API first, fall back to execCommand, return false if both fail.
   * The clipboard API can reject after an async gap (user activation expires).
   */
  private async copyToClipboard(text: string): Promise<boolean> {
    // Try modern clipboard API
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Expected on Firefox after async gap — fall through to legacy
    }

    // Legacy fallback: temporary textarea + execCommand
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }

  /**
   * Show feedback with a selectable URL input so user can copy manually.
   * Used when both clipboard methods fail.
   */
  private showFeedbackWithUrl(message: string, url: string): void {
    clearTimeout(this.feedbackTimeout);

    this.feedback.classList.remove('fade-out');
    this.feedbackText.innerHTML = '';

    const label = document.createElement('span');
    label.textContent = message + ' ';
    this.feedbackText.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    input.value = url;
    input.className = 'share-url-fallback';
    input.addEventListener('click', () => input.select());
    this.feedbackText.appendChild(input);

    this.feedback.style.display = 'block';

    // Select the URL automatically so a quick Ctrl+C works
    requestAnimationFrame(() => input.select());

    // Longer timeout since user needs to manually copy
    this.feedbackTimeout = setTimeout(() => {
      this.feedback.classList.add('fade-out');
      setTimeout(() => {
        this.feedback.style.display = 'none';
        this.feedback.classList.remove('fade-out');
      }, 300);
    }, 10000);
  }

  /**
   * Show feedback message temporarily with smooth fadeout
   */
  private showFeedback(message: string): void {
    clearTimeout(this.feedbackTimeout);

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
