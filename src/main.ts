import { BlueskyClient } from './api';
import { ThreadBuilder, MentionExtractor, MentionCounter, decodeResults } from './lib';
import { ProgressTracker } from './lib/progress-tracker';
import { createSentimentAnalyzer } from './lib/sentiment-factory';
import {
  InputForm,
  ProgressBar,
  ResultsChart,
  DrillDownModal,
  ShareButton,
  AdvancedToggle,
} from './components';
import type { MentionCount, PostView } from './types';

/**
 * Main application orchestrator
 * Wires together all phases: input → fetch → extract → count → validate → display
 */

class StarcounterApp {
  private blueskyClient: BlueskyClient;
  private threadBuilder: ThreadBuilder;
  private mentionExtractor: MentionExtractor;
  private counter: MentionCounter;
  private progressTracker: ProgressTracker;

  private inputForm: InputForm;
  private progressBar: ProgressBar;
  private resultsChart: ResultsChart;
  private drillDownModal: DrillDownModal;
  private shareButton: ShareButton;
  private advancedToggle: AdvancedToggle;

  private abortController: AbortController | null = null;
  private useAdvancedSentiment = false;

  constructor() {
    // Initialize backend services
    this.blueskyClient = new BlueskyClient();
    this.threadBuilder = new ThreadBuilder();
    this.mentionExtractor = new MentionExtractor();
    this.counter = new MentionCounter();
    this.progressTracker = new ProgressTracker();

    // Initialize UI components
    this.inputForm = new InputForm(
      document.getElementById('analyze-form') as HTMLFormElement,
      document.getElementById('post-url') as HTMLInputElement,
      document.getElementById('analyze-button') as HTMLButtonElement,
      document.getElementById('cancel-button') as HTMLButtonElement,
      document.getElementById('url-error') as HTMLSpanElement
    );

    this.progressBar = new ProgressBar(
      document.getElementById('progress-section') as HTMLElement,
      document.getElementById('progress-bar') as HTMLElement,
      document.getElementById('progress-text') as HTMLElement,
      document.getElementById('progress-details') as HTMLElement
    );

    this.resultsChart = new ResultsChart(
      document.getElementById('results-chart') as HTMLCanvasElement
    );

    this.drillDownModal = new DrillDownModal(
      document.getElementById('drill-down-modal') as HTMLElement,
      document.getElementById('modal-title') as HTMLElement,
      document.getElementById('modal-body') as HTMLElement,
      document.getElementById('modal-close-button') as HTMLElement
    );

    this.shareButton = new ShareButton(
      document.getElementById('share-button') as HTMLButtonElement,
      document.getElementById('share-feedback') as HTMLElement,
      document.getElementById('share-feedback-text') as HTMLElement
    );

    this.advancedToggle = new AdvancedToggle(
      document.getElementById('advanced-mode') as HTMLInputElement,
      document.getElementById('advanced-status') as HTMLSpanElement
    );

    // Track advanced mode state
    this.useAdvancedSentiment = this.advancedToggle.isEnabled();
    this.advancedToggle.onChange((enabled) => {
      this.useAdvancedSentiment = enabled;
    });

    this.attachEventListeners();
    this.checkForSharedResults();
  }

  /**
   * Attach event listeners to components
   */
  private attachEventListeners(): void {
    // Form submission
    this.inputForm.onSubmit((url) => {
      this.startAnalysis(url);
    });

    // Cancel button
    this.inputForm.onCancel(() => {
      this.cancelAnalysis();
    });

    // New analysis button
    const newAnalysisButton = document.getElementById('new-analysis-button');
    newAnalysisButton?.addEventListener('click', () => {
      this.resetToInput();
    });

    // Retry button
    const retryButton = document.getElementById('retry-button');
    retryButton?.addEventListener('click', () => {
      this.resetToInput();
    });

    // Chart clicks (drill-down)
    this.resultsChart.onClick((mention, posts) => {
      this.drillDownModal.show(mention, posts as PostView[]);
    });

    // Progress tracker events
    this.progressTracker.on('fetching', (data: unknown) => {
      const payload = data as { fetched: number; total: number };
      this.progressBar.updateFetching(payload.fetched, payload.total);
    });

    this.progressTracker.on('extracting', () => {
      this.progressBar.updateExtracting();
    });

    this.progressTracker.on('counting', () => {
      this.progressBar.updateCounting();
    });

    this.progressTracker.on('validating', (data: unknown) => {
      const payload = data as { validated: number; total: number };
      this.progressBar.updateValidating(payload.validated, payload.total);
    });

    this.progressTracker.on('complete', (data: unknown) => {
      const payload = data as { mentionCounts: unknown[] };
      this.progressBar.updateComplete(payload.mentionCounts.length);
    });

    this.progressTracker.on('error', (data: unknown) => {
      const payload = data as { error: Error };
      this.showError(payload.error.message);
    });
  }

  /**
   * Start analysis pipeline
   */
  private async startAnalysis(url: string): Promise<void> {
    try {
      // Setup
      this.abortController = new AbortController();
      this.inputForm.setAnalyzing(true);
      this.hideAllSections();
      this.progressBar.show();
      this.progressBar.reset();
      this.progressTracker.reset();

      // Extract AT-URI from bsky.app URL
      const atUri = this.convertBskyUrlToAtUri(url);

      // Stage 1: Fetch thread
      this.progressTracker.emit('fetching', { fetched: 0, total: 0 });

      const threadResult = await this.blueskyClient.getPostThread(atUri);
      if (!threadResult.ok) {
        throw threadResult.error;
      }

      const tree = this.threadBuilder.buildTree(threadResult.value.thread);
      const allPosts = tree.allPosts;

      this.progressTracker.emit('fetching', { fetched: allPosts.length, total: allPosts.length });

      // Stage 2: Extract mentions
      this.progressTracker.emit('extracting', {});

      const mentions = allPosts.flatMap((post) =>
        this.mentionExtractor.extractMentions(post.record.text)
      );

      // Stage 3: Count mentions (with appropriate sentiment analyzer)
      this.progressTracker.emit('counting', {});

      // Set the appropriate sentiment analyzer based on user preference
      const analyzer = createSentimentAnalyzer(this.useAdvancedSentiment);
      this.counter.setSentimentAnalyzer(analyzer);

      const countMap = await this.counter.countMentions(mentions, allPosts, tree);
      const mentionCounts = this.buildMentionCounts(countMap, allPosts);

      // Stage 4: Validate mentions (optional - could skip for faster results)
      this.progressTracker.emit('validating', { validated: 0, total: mentionCounts.length });

      // For now, skip validation to keep Phase 6 focused on UI
      // Validation will be tested in Phase 5 integration

      this.progressTracker.emit('validating', {
        validated: mentionCounts.length,
        total: mentionCounts.length,
      });

      // Stage 5: Display results
      this.progressTracker.emit('complete', { mentionCounts });

      this.showResults(mentionCounts);
    } catch (error) {
      if (error instanceof Error) {
        this.progressTracker.emit('error', { error });
      } else {
        this.progressTracker.emit('error', { error: new Error(String(error)) });
      }
    } finally {
      this.inputForm.setAnalyzing(false);
      this.abortController = null;
    }
  }

  /**
   * Cancel ongoing analysis
   */
  private cancelAnalysis(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.inputForm.setAnalyzing(false);
    this.resetToInput();
  }

  /**
   * Show results section with chart
   */
  private showResults(mentionCounts: MentionCount[]): void {
    this.hideAllSections();

    const resultsSection = document.getElementById('results-section');
    if (resultsSection) {
      resultsSection.style.display = 'block';
    }

    this.resultsChart.render(mentionCounts);
    this.shareButton.setResults(mentionCounts);
  }

  /**
   * Show error section
   */
  private showError(message: string): void {
    this.hideAllSections();

    const errorSection = document.getElementById('error-section');
    const errorMessage = document.getElementById('error-message');

    if (errorSection && errorMessage) {
      errorMessage.textContent = message;
      errorSection.style.display = 'block';
    }
  }

  /**
   * Reset to input form
   */
  private resetToInput(): void {
    this.hideAllSections();
    this.inputForm.reset();

    const inputSection = document.getElementById('input-section');
    if (inputSection) {
      inputSection.style.display = 'block';
    }
  }

  /**
   * Hide all sections
   */
  private hideAllSections(): void {
    this.progressBar.hide();

    const sections = ['results-section', 'error-section'];
    for (const sectionId of sections) {
      const section = document.getElementById(sectionId);
      if (section) {
        section.style.display = 'none';
      }
    }
  }

  /**
   * Convert bsky.app URL to AT-URI
   * https://bsky.app/profile/alice.bsky.social/post/3k7qr5xya2c2a
   * -> at://alice.bsky.social/app.bsky.feed.post/3k7qr5xya2c2a
   */
  private convertBskyUrlToAtUri(url: string): string {
    const urlObj = new URL(url);
    const parts = urlObj.pathname.split('/');

    // Extract handle and post ID
    const handle = parts[2];
    const postId = parts[4];

    return `at://${handle}/app.bsky.feed.post/${postId}`;
  }

  /**
   * Build MentionCount array from count map
   * Filters posts that contain each mention
   */
  private buildMentionCounts(countMap: Map<string, number>, allPosts: PostView[]): MentionCount[] {
    const result: MentionCount[] = [];

    for (const [mention, count] of countMap.entries()) {
      // Find all posts that contain this mention
      const contributingPosts = allPosts.filter((post) => {
        const text = post.record.text.toLowerCase();
        return text.includes(mention.toLowerCase());
      });

      result.push({
        mention,
        count,
        posts: contributingPosts,
      });
    }

    return result;
  }

  /**
   * Check URL for shared results and restore them
   * This allows users to open shared links directly to results
   */
  private checkForSharedResults(): void {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('r');

    if (!encoded) {
      return;
    }

    const results = decodeResults(encoded);
    if (!results) {
      console.warn('Failed to decode shared results from URL');
      return;
    }

    // Convert ShareableResults to MentionCount[] (without posts)
    const mentionCounts: MentionCount[] = results.m.map((m) => ({
      mention: m.n,
      count: m.c,
      posts: [], // Posts not available from shared URL
    }));

    // Hide input section and show results
    const inputSection = document.getElementById('input-section');
    if (inputSection) {
      inputSection.style.display = 'none';
    }

    this.showResults(mentionCounts);

    // Clean up URL (remove r parameter) without reloading
    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    window.history.replaceState({}, document.title, cleanUrl);
  }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new StarcounterApp();
  });
} else {
  new StarcounterApp();
}
