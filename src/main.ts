import { BlueskyClient } from './api';
import { decodeResults, analyzeThread } from './lib';
import { ProgressTracker } from './lib/progress-tracker';
import {
  InputForm,
  ProgressBar,
  ResultsChart,
  DrillDownModal,
  ClusterReviewModal,
  ShareButton,
  AdvancedToggle,
} from './components';
import { suggestClusters } from './lib/clustering';
import { fromStoredPost } from './lib/share-types';
import type { SharedData } from './lib/share-types';
import type { MentionCount, PostView } from './types';

/**
 * Get a DOM element by ID with runtime validation.
 * Throws a helpful error if the element is not found, preventing silent failures.
 */
function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(
      `Required element #${id} not found. Check that the HTML template includes this element.`
    );
  }
  return el as T;
}

/**
 * Main application orchestrator
 * Wires together all phases: input → fetch → extract → count → validate → display
 */

class StarcounterApp {
  private blueskyClient: BlueskyClient;
  private progressTracker: ProgressTracker;

  private inputForm: InputForm;
  private progressBar: ProgressBar;
  private resultsChart: ResultsChart;
  private drillDownModal: DrillDownModal;
  private clusterReviewModal: ClusterReviewModal;
  private shareButton: ShareButton;

  private abortController: AbortController | null = null;
  private analysisStartTime: number = 0;
  private originalPost: PostView | null = null;

  // State for re-rendering with uncategorized toggle
  private lastMentionCounts: MentionCount[] = [];
  private lastUncategorizedPosts: PostView[] = [];
  private lastPostCount: number = 0;

  // User refinement state
  private excludedCategories: Set<string> = new Set();
  private manualAssignments: Map<string, string> = new Map(); // postUri → category
  private manualTags: Map<string, PostView[]> = new Map(); // tag → matching posts
  private lastAllPosts: PostView[] = []; // All posts for manual tag searching

  constructor() {
    // Initialize backend services
    this.blueskyClient = new BlueskyClient();
    this.progressTracker = new ProgressTracker();

    // Initialize UI components with null-safe element access
    this.inputForm = new InputForm(
      requireElement<HTMLFormElement>('analyze-form'),
      requireElement<HTMLInputElement>('post-url'),
      requireElement<HTMLButtonElement>('analyze-button'),
      requireElement<HTMLButtonElement>('cancel-button'),
      requireElement<HTMLSpanElement>('url-error')
    );

    this.progressBar = new ProgressBar(
      requireElement<HTMLElement>('progress-section'),
      requireElement<HTMLElement>('progress-bar'),
      requireElement<HTMLElement>('progress-text'),
      requireElement<HTMLElement>('progress-details')
    );

    this.resultsChart = new ResultsChart(requireElement<HTMLCanvasElement>('results-chart'));

    this.drillDownModal = new DrillDownModal(
      requireElement<HTMLElement>('drill-down-modal'),
      requireElement<HTMLElement>('modal-title'),
      requireElement<HTMLElement>('modal-body'),
      requireElement<HTMLElement>('modal-close-button')
    );

    this.clusterReviewModal = new ClusterReviewModal(
      requireElement<HTMLElement>('cluster-review-modal'),
      requireElement<HTMLElement>('cluster-modal-title'),
      requireElement<HTMLElement>('cluster-modal-body'),
      requireElement<HTMLElement>('cluster-modal-close-button')
    );

    this.shareButton = new ShareButton(
      requireElement<HTMLButtonElement>('share-button'),
      requireElement<HTMLElement>('share-feedback'),
      requireElement<HTMLElement>('share-feedback-text')
    );

    // State provider captures current app state at share time (including user tweaks)
    this.shareButton.setStateProvider(() => ({
      mentionCounts: this.lastMentionCounts,
      uncategorizedPosts: this.lastUncategorizedPosts,
      excludedCategories: [...this.excludedCategories],
      manualAssignments: Object.fromEntries(this.manualAssignments),
      originalPost: this.originalPost,
      postCount: this.lastPostCount,
    }));

    // AdvancedToggle attaches DOM listeners in its constructor; instance not needed after setup
    new AdvancedToggle(
      requireElement<HTMLInputElement>('advanced-mode'),
      requireElement<HTMLSpanElement>('advanced-status')
    );

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

    // Media type checkbox toggle → show/hide custom list textarea
    const mediaCheckboxes = Array.from(
      document.querySelectorAll<HTMLInputElement>('#media-type-group input[type="checkbox"]')
    );
    const customListGroup = document.getElementById('custom-list-group');
    const updateCustomListVisibility = () => {
      const anyChecked = mediaCheckboxes.some((cb) => cb.checked);
      if (customListGroup) {
        customListGroup.style.display = anyChecked ? 'none' : 'block';
      }
    };
    for (const cb of mediaCheckboxes) {
      cb.addEventListener('change', updateCustomListVisibility);
    }
    updateCustomListVisibility();

    // Uncategorized posts toggle
    const uncategorizedCheckbox = document.getElementById('show-uncategorized');
    uncategorizedCheckbox?.addEventListener('change', () => {
      this.refreshResultsDisplay();
    });

    // Chart clicks (drill-down)
    this.resultsChart.onClick((mention, posts) => {
      this.drillDownModal.show(mention, posts as PostView[]);
    });

    // Drill-down modal callbacks for user refinement
    this.drillDownModal.setCallbacks({
      onExclude: (category) => this.excludeCategory(category),
      onAssign: (postUri, category) => this.assignPostToCategory(postUri, category),
      getCategories: () => this.getAvailableCategories(),
      onAddTag: () => this.showAddTagModal(),
    });

    // Cluster review modal callbacks
    this.clusterReviewModal.setCallbacks({
      onAcceptCluster: (postUris, category) => {
        // Assign all posts in cluster to the category
        for (const uri of postUris) {
          this.manualAssignments.set(uri, category);
        }
        this.refreshResultsDisplay();
      },
      onDismissCluster: () => {
        // Dismissal is handled internally by the modal
      },
    });

    // Review suggestions button
    const reviewSuggestionsButton = document.getElementById('review-suggestions-button');
    reviewSuggestionsButton?.addEventListener('click', () => {
      this.showClusterReviewModal();
    });

    // Add tag modal
    this.setupAddTagModal();
  }

  private attachProgressListeners(): void {
    this.progressTracker.on('fetching', (data) => {
      this.progressBar.updateFetching(data.fetched, data.stage);
    });
    this.progressTracker.on('extracting', () => {
      this.progressBar.updateExtracting();
    });
    this.progressTracker.on('counting', () => {
      this.progressBar.updateCounting();
    });
    this.progressTracker.on('validating', (data) => {
      this.progressBar.updateValidating(data.validated, data.total);
    });
    this.progressTracker.on('complete', (data) => {
      this.progressBar.updateComplete(data.mentionCounts.length);
    });
    this.progressTracker.on('error', (data) => {
      this.showError(data.error.message);
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
      this.attachProgressListeners();
      this.analysisStartTime = Date.now();
      this.originalPost = null;

      // Reset user refinement state
      this.excludedCategories.clear();
      this.manualAssignments.clear();
      this.manualTags.clear();
      this.clusterReviewModal.reset();

      // Extract AT-URI from bsky.app URL
      const atUri = this.convertBskyUrlToAtUri(url);

      const selectedTypes = this.getSelectedMediaTypes();
      const customList = this.getCustomValidationList();

      // Run headless analysis pipeline
      this.progressTracker.emit('fetching', { fetched: 0, stage: 'thread' });

      const result = await analyzeThread(atUri, this.blueskyClient, {
        validationApiUrl: selectedTypes.length > 0 ? '/api/validate' : undefined,
        oembedApiUrl: '/api/oembed',
        mediaTypes: selectedTypes,
        customList,
        onProgress: (stage, detail) => {
          if (stage === 'validating') {
            this.progressTracker.emit('validating', { validated: 0, total: 0 });
          } else if (stage === 'counting') {
            this.progressTracker.emit('counting', {});
          }
          console.log(`[Analysis] ${stage}: ${detail}`);
        },
        onFetchProgress: (progress) => {
          this.progressTracker.emit('fetching', {
            fetched: progress.fetched,
            stage: progress.stage,
          });
        },
      });

      this.originalPost = result.rootPost;

      // Display results
      this.progressTracker.emit('complete', { mentionCounts: result.mentionCounts });

      // Store allPosts for manual tag searching (all posts from the thread)
      this.lastAllPosts = result.mentionCounts.flatMap((mc) => mc.posts);
      // Also include uncategorized posts
      this.lastAllPosts.push(...result.uncategorizedPosts);
      // Add root post
      this.lastAllPosts.unshift(result.rootPost);

      this.showResults(result.mentionCounts, result.postCount, result.uncategorizedPosts);
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
  private showResults(
    mentionCounts: MentionCount[],
    postCount?: number,
    uncategorizedPosts?: PostView[]
  ): void {
    // Store state for re-rendering with toggle and sharing
    this.lastMentionCounts = mentionCounts;
    this.lastUncategorizedPosts = uncategorizedPosts ?? [];
    if (postCount !== undefined) {
      this.lastPostCount = postCount;
    }

    this.hideAllSections();

    const resultsSection = document.getElementById('results-section');
    if (resultsSection) {
      resultsSection.style.display = 'block';
    }

    // Display the original prompt post
    this.displayOriginalPost();

    // Display analysis stats (elapsed time and post count)
    const statsEl = document.getElementById('analysis-stats');
    if (statsEl) {
      if (this.analysisStartTime > 0 && postCount !== undefined) {
        const elapsedMs = Date.now() - this.analysisStartTime;
        const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
        statsEl.textContent = `Analyzed ${postCount.toLocaleString()} posts in ${elapsedSeconds}s`;
      } else if (postCount !== undefined) {
        statsEl.textContent = `Analyzed ${postCount.toLocaleString()} posts`;
      } else {
        statsEl.textContent = '';
      }
    }

    // Build final counts, optionally including uncategorized
    const finalCounts = this.buildFinalCounts(mentionCounts, uncategorizedPosts ?? []);

    this.resultsChart.render(finalCounts);

    // Show/hide "Review Suggestions" button based on uncategorized posts
    this.updateReviewSuggestionsButton();
  }

  /**
   * Update visibility of the "Review Suggestions" button
   */
  private updateReviewSuggestionsButton(): void {
    const button = document.getElementById('review-suggestions-button');
    if (!button) return;

    // Get remaining uncategorized posts (minus manually assigned ones)
    const remainingUncategorized = this.lastUncategorizedPosts.filter(
      (p) => !this.manualAssignments.has(p.uri)
    );

    // Only show if there are uncategorized posts
    if (remainingUncategorized.length === 0) {
      button.style.display = 'none';
      return;
    }

    // Check if there are potential suggestions
    const uncategorizedTexts = new Map<string, string>();
    for (const post of remainingUncategorized) {
      uncategorizedTexts.set(post.uri, post.record.text);
    }

    const categories = this.getAvailableCategories();
    const suggestions = suggestClusters(uncategorizedTexts, categories);

    if (suggestions.length > 0) {
      button.style.display = 'inline-block';
      button.textContent = `Review Suggestions (${suggestions.reduce((sum, s) => sum + s.postUris.length, 0)} posts)`;
    } else {
      button.style.display = 'none';
    }
  }

  /**
   * Build final mention counts with exclusions, manual assignments, and uncategorized
   */
  private buildFinalCounts(
    mentionCounts: MentionCount[],
    uncategorizedPosts: PostView[]
  ): MentionCount[] {
    // Start with a mutable copy of counts
    const countsByMention = new Map<string, { count: number; posts: PostView[] }>();

    for (const mc of mentionCounts) {
      countsByMention.set(mc.mention, { count: mc.count, posts: [...mc.posts] });
    }

    // Track which posts have been manually assigned (to remove from uncategorized)
    const manuallyAssignedUris = new Set<string>();

    // Apply manual assignments: move posts from uncategorized to their assigned category
    for (const [postUri, category] of this.manualAssignments) {
      manuallyAssignedUris.add(postUri);

      // Find the post in uncategorized
      const post = uncategorizedPosts.find((p) => p.uri === postUri);
      if (!post) continue;

      // Add to the target category
      const existing = countsByMention.get(category);
      if (existing) {
        // Only add if not already in the category
        if (!existing.posts.some((p) => p.uri === postUri)) {
          existing.posts.push(post);
          existing.count++;
        }
      } else {
        // Category doesn't exist yet (shouldn't happen with current UI, but be safe)
        countsByMention.set(category, { count: 1, posts: [post] });
      }
    }

    // Add manual tags
    for (const [tag, posts] of this.manualTags) {
      const existing = countsByMention.get(tag);
      if (existing) {
        // Merge posts, avoiding duplicates
        for (const post of posts) {
          if (!existing.posts.some((p) => p.uri === post.uri)) {
            existing.posts.push(post);
            existing.count++;
          }
        }
      } else {
        countsByMention.set(tag, { count: posts.length, posts: [...posts] });
      }
    }

    // Filter out excluded categories and rebuild array
    const result: MentionCount[] = [];
    for (const [mention, data] of countsByMention) {
      if (!this.excludedCategories.has(mention)) {
        result.push({ mention, count: data.count, posts: data.posts });
      }
    }

    // Sort by count descending
    result.sort((a, b) => b.count - a.count);

    // Handle uncategorized posts (minus manually assigned ones)
    const showUncategorized = document.getElementById(
      'show-uncategorized'
    ) as HTMLInputElement | null;

    const remainingUncategorized = uncategorizedPosts.filter(
      (p) => !manuallyAssignedUris.has(p.uri)
    );

    if (showUncategorized?.checked && remainingUncategorized.length > 0) {
      result.push({
        mention: '(Uncategorized)',
        count: remainingUncategorized.length,
        posts: remainingUncategorized,
      });
    }

    return result;
  }

  /**
   * Refresh results display when uncategorized toggle changes
   */
  private refreshResultsDisplay(): void {
    if (this.lastMentionCounts.length === 0) return;

    const finalCounts = this.buildFinalCounts(this.lastMentionCounts, this.lastUncategorizedPosts);
    this.resultsChart.render(finalCounts);
    this.updateExcludedCategoriesUI();
    this.updateReviewSuggestionsButton();
  }

  /**
   * Exclude a category from results
   */
  private excludeCategory(category: string): void {
    this.excludedCategories.add(category);
    this.refreshResultsDisplay();
  }

  /**
   * Restore a previously excluded category
   */
  private restoreCategory(category: string): void {
    this.excludedCategories.delete(category);
    this.refreshResultsDisplay();
  }

  /**
   * Manually assign a post to a category
   */
  private assignPostToCategory(postUri: string, category: string): void {
    this.manualAssignments.set(postUri, category);
    this.refreshResultsDisplay();
  }

  /**
   * Get list of available categories for manual assignment
   */
  private getAvailableCategories(): string[] {
    return this.lastMentionCounts
      .filter((mc) => !this.excludedCategories.has(mc.mention))
      .map((mc) => mc.mention);
  }

  /**
   * Add a manual tag by searching all posts for case-insensitive matches
   * Returns the number of matching posts found
   */
  private addManualTag(title: string): { count: number; alreadyExists: boolean } {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return { count: 0, alreadyExists: false };
    }

    // Check if tag already exists (in manual tags or existing mention counts)
    const existingManual = this.manualTags.has(trimmedTitle);
    const existingMention = this.lastMentionCounts.some(
      (mc) => mc.mention.toLowerCase() === trimmedTitle.toLowerCase()
    );
    if (existingManual || existingMention) {
      return { count: 0, alreadyExists: true };
    }

    // Search all posts for case-insensitive match
    const pattern = new RegExp(`\\b${this.escapeRegex(trimmedTitle)}\\b`, 'i');
    const matchingPosts = this.lastAllPosts.filter((post) => pattern.test(post.record.text));

    if (matchingPosts.length > 0) {
      this.manualTags.set(trimmedTitle, matchingPosts);
      this.refreshResultsDisplay();
    }

    return { count: matchingPosts.length, alreadyExists: false };
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Show cluster review modal with suggestions for uncategorized posts
   */
  private showClusterReviewModal(): void {
    // Get remaining uncategorized posts (minus manually assigned ones)
    const remainingUncategorized = this.lastUncategorizedPosts.filter(
      (p) => !this.manualAssignments.has(p.uri)
    );

    if (remainingUncategorized.length === 0) {
      return;
    }

    // Build a map of post URIs to their text for the clustering algorithm
    const uncategorizedTexts = new Map<string, string>();
    for (const post of remainingUncategorized) {
      uncategorizedTexts.set(post.uri, post.record.text);
    }

    // Get current category names
    const categories = this.getAvailableCategories();

    // Get cluster suggestions
    const suggestions = suggestClusters(uncategorizedTexts, categories);

    if (suggestions.length === 0) {
      return;
    }

    // Build a map of post URIs to PostView for the modal to render
    const postsByUri = new Map<string, PostView>();
    for (const post of remainingUncategorized) {
      postsByUri.set(post.uri, post);
    }

    // Show the modal
    this.clusterReviewModal.show({
      suggestions,
      postsByUri,
    });
  }

  /**
   * Update the excluded categories UI
   */
  private updateExcludedCategoriesUI(): void {
    const container = document.getElementById('excluded-categories');
    if (!container) return;

    if (this.excludedCategories.size === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';

    const list = container.querySelector('.excluded-list');
    if (!list) return;

    list.innerHTML = '';

    for (const category of this.excludedCategories) {
      const item = document.createElement('span');
      item.className = 'excluded-item';
      item.innerHTML = `
        ${this.escapeHtml(category)}
        <button class="excluded-restore" aria-label="Restore ${this.escapeHtml(category)}">×</button>
      `;

      const restoreBtn = item.querySelector('.excluded-restore');
      restoreBtn?.addEventListener('click', () => {
        this.restoreCategory(category);
      });

      list.appendChild(item);
    }
  }

  /**
   * Setup the Add Tag modal UI
   */
  private setupAddTagModal(): void {
    const modal = document.getElementById('add-tag-modal');
    const closeBtn = document.getElementById('add-tag-modal-close');
    const submitBtn = document.getElementById('add-tag-submit');
    const cancelBtn = document.getElementById('add-tag-cancel');
    const input = document.getElementById('add-tag-input') as HTMLInputElement | null;
    const resultEl = document.getElementById('add-tag-result');
    const addTagButton = document.getElementById('add-tag-button');

    if (!modal || !closeBtn || !submitBtn || !cancelBtn || !input || !resultEl || !addTagButton) {
      return;
    }

    const showModal = () => {
      modal.style.display = 'flex';
      input.value = '';
      resultEl.style.display = 'none';
      input.focus();
    };

    const hideModal = () => {
      modal.style.display = 'none';
    };

    const handleSubmit = () => {
      const title = input.value.trim();
      if (!title) return;

      const { count, alreadyExists } = this.addManualTag(title);

      if (alreadyExists) {
        resultEl.textContent = `"${title}" already exists in results`;
        resultEl.className = 'add-tag-result error';
        resultEl.style.display = 'block';
      } else if (count === 0) {
        resultEl.textContent = `No posts found containing "${title}"`;
        resultEl.className = 'add-tag-result error';
        resultEl.style.display = 'block';
      } else {
        resultEl.textContent = `Added "${title}" with ${count} post${count === 1 ? '' : 's'}`;
        resultEl.className = 'add-tag-result success';
        resultEl.style.display = 'block';
        // Clear input for another entry
        input.value = '';
        input.focus();
      }
    };

    // Wire up events
    addTagButton.addEventListener('click', showModal);
    closeBtn.addEventListener('click', hideModal);
    cancelBtn.addEventListener('click', hideModal);
    submitBtn.addEventListener('click', handleSubmit);

    // Enter key submits
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'Escape') {
        hideModal();
      }
    });

    // Click outside closes
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        hideModal();
      }
    });
  }

  /**
   * Show the add tag modal (can be called from other places)
   */
  private showAddTagModal(): void {
    const modal = document.getElementById('add-tag-modal');
    const input = document.getElementById('add-tag-input') as HTMLInputElement | null;
    const resultEl = document.getElementById('add-tag-result');

    if (modal && input && resultEl) {
      modal.style.display = 'flex';
      input.value = '';
      resultEl.style.display = 'none';
      input.focus();
    }
  }

  /**
   * Display the original prompt post above results
   */
  private displayOriginalPost(): void {
    const promptContainer = document.getElementById('original-prompt');
    if (!promptContainer) return;

    if (!this.originalPost) {
      promptContainer.style.display = 'none';
      return;
    }

    const post = this.originalPost;
    const author = post.author;
    const displayName = author.displayName || author.handle;

    // Build the Bluesky URL for the post
    const postId = post.uri.split('/').pop();
    const postUrl = `https://bsky.app/profile/${author.handle}/post/${postId}`;

    promptContainer.innerHTML = `
      <div class="prompt-post">
        <div class="prompt-author">
          ${author.avatar ? `<img src="${author.avatar}" alt="" class="prompt-avatar">` : ''}
          <div class="prompt-author-info">
            <span class="prompt-display-name">${this.escapeHtml(displayName)}</span>
            <span class="prompt-handle">@${this.escapeHtml(author.handle)}</span>
          </div>
        </div>
        <div class="prompt-text">${this.escapeHtml(post.record.text)}</div>
        <a href="${postUrl}" target="_blank" rel="noopener noreferrer" class="prompt-link">
          View original post →
        </a>
      </div>
    `;
    promptContainer.style.display = 'block';
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Categorize error and return user-friendly message
   */
  private categorizeError(message: string): string {
    const lowerMessage = message.toLowerCase();

    // Network errors
    if (
      lowerMessage.includes('failed to fetch') ||
      lowerMessage.includes('network') ||
      lowerMessage.includes('connection') ||
      lowerMessage.includes('timeout')
    ) {
      return 'Unable to reach Bluesky. Please check your internet connection and try again.';
    }

    // Rate limiting
    if (
      lowerMessage.includes('429') ||
      lowerMessage.includes('rate limit') ||
      lowerMessage.includes('too many')
    ) {
      return 'Too many requests. Please wait a few seconds and try again.';
    }

    // Authentication
    if (
      lowerMessage.includes('401') ||
      lowerMessage.includes('unauthorized') ||
      lowerMessage.includes('auth')
    ) {
      return 'This post may be private or restricted.';
    }

    // Not found
    if (lowerMessage.includes('404') || lowerMessage.includes('not found')) {
      return 'Post not found. The URL might be incorrect or the post may have been deleted.';
    }

    // Invalid URL
    if (lowerMessage.includes('invalid') && lowerMessage.includes('url')) {
      return "That doesn't look like a Bluesky post URL. Example: https://bsky.app/profile/handle/post/xxxxx";
    }

    // Server errors
    if (lowerMessage.includes('500') || lowerMessage.includes('server error')) {
      return 'Bluesky is having issues right now. Please try again in a few minutes.';
    }

    // Aborted by user
    if (lowerMessage.includes('abort')) {
      return 'Analysis was cancelled.';
    }

    // Default: show original message
    return message;
  }

  /**
   * Show error section with user-friendly message
   */
  private showError(message: string): void {
    this.hideAllSections();

    const errorSection = document.getElementById('error-section');
    const errorMessage = document.getElementById('error-message');

    if (errorSection && errorMessage) {
      // Categorize error for better user experience
      const friendlyMessage = this.categorizeError(message);
      errorMessage.textContent = friendlyMessage;
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
   * Get selected media types from checkboxes
   */
  private getSelectedMediaTypes(): string[] {
    const checkboxes = document.querySelectorAll<HTMLInputElement>(
      '#media-type-group input[type="checkbox"]:checked'
    );
    return Array.from(checkboxes).map((cb) => cb.value);
  }

  private getCustomValidationList(): string[] {
    const textarea = document.querySelector<HTMLTextAreaElement>('#custom-list');
    if (!textarea || !textarea.value.trim()) return [];
    return textarea.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
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
   * Check URL for shared results and restore them.
   * Supports both D1-backed (?s=) and legacy LZ-compressed (?r=) formats.
   */
  private checkForSharedResults(): void {
    const params = new URLSearchParams(window.location.search);

    // New D1-backed sharing (?s= parameter) — includes drill-down data
    const shareId = params.get('s');
    if (shareId) {
      this.loadD1SharedResults(shareId);
      return;
    }

    // Legacy URL-encoded sharing (?r= parameter) — counts only, no drill-down
    const encoded = params.get('r');
    if (encoded) {
      this.loadLegacySharedResults(encoded);
    }
  }

  /**
   * Load shared results from D1 database.
   * Restores full state including drill-down posts and user tweaks.
   */
  private async loadD1SharedResults(shareId: string): Promise<void> {
    // Hide input, show loading state
    const inputSection = document.getElementById('input-section');
    if (inputSection) {
      inputSection.style.display = 'none';
    }
    this.progressBar.show();
    this.progressBar.reset();
    this.progressBar.setIndeterminate(true);
    this.progressBar.setText('Loading shared results...');

    try {
      const response = await fetch(`/api/share?id=${encodeURIComponent(shareId)}`);
      if (!response.ok) {
        throw new Error(`failed to load shared results: ${response.status}`);
      }

      const data: SharedData = await response.json();

      // Restore MentionCount[] with full post data for drill-downs
      const mentionCounts: MentionCount[] = data.mentionCounts.map((mc) => ({
        mention: mc.mention,
        count: mc.count,
        posts: mc.posts.map(fromStoredPost),
      }));

      const uncategorizedPosts = data.uncategorizedPosts.map(fromStoredPost);

      // Restore original post for prompt display
      if (data.originalPost) {
        this.originalPost = fromStoredPost(data.originalPost);
      }

      // Restore user tweaks (exclusions and manual assignments)
      for (const category of data.excludedCategories) {
        this.excludedCategories.add(category);
      }
      for (const [uri, category] of Object.entries(data.manualAssignments)) {
        this.manualAssignments.set(uri, category);
      }

      this.showResults(mentionCounts, data.postCount, uncategorizedPosts);
    } catch (error) {
      console.warn('Failed to load shared results:', error);
      // Show input form on failure
      this.progressBar.hide();
      if (inputSection) {
        inputSection.style.display = 'block';
      }
      return;
    }

    // Clean up URL without reloading
    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  /**
   * Load legacy shared results from LZ-compressed URL parameter.
   * Only has names and counts — no drill-down data.
   */
  private loadLegacySharedResults(encoded: string): void {
    const results = decodeResults(encoded);
    if (!results) {
      console.warn('Failed to decode shared results from URL');
      return;
    }

    // Convert ShareableResults to MentionCount[] (without posts)
    const mentionCounts: MentionCount[] = results.m.map((m) => ({
      mention: m.n,
      count: m.c,
      posts: [], // Posts not available from legacy shared URL
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
