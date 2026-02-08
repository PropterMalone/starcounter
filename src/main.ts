import { BlueskyClient } from './api';
import {
  ThreadBuilder,
  decodeResults,
  extractPostText,
  buildValidationLookup,
  discoverDictionary,
  labelPosts,
} from './lib';
import { ProgressTracker } from './lib/progress-tracker';
import { ValidationClient } from './lib/validation-client';
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
import { buildSelfValidatedLookup, buildListValidatedLookup } from './lib/self-validation';
import { fromStoredPost } from './lib/share-types';
import type { SharedData } from './lib/share-types';
import type { MentionCount, PostView } from './types';
import type { MediaMention } from './lib/mention-extractor';
import type { PostTextContent } from './lib/text-extractor';
import { extractCandidates, extractShortTextCandidate } from './lib/thread-dictionary';

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
  private threadBuilder: ThreadBuilder;
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

  constructor() {
    // Initialize backend services
    this.blueskyClient = new BlueskyClient();
    this.threadBuilder = new ThreadBuilder();
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
      this.clusterReviewModal.reset();

      // Extract AT-URI from bsky.app URL
      const atUri = this.convertBskyUrlToAtUri(url);

      // Stage 1+2+3: Fetch thread and extract text/candidates incrementally
      this.progressTracker.emit('fetching', { fetched: 0, stage: 'thread' });

      const selectedTypes = this.getSelectedMediaTypes();

      // Shared state for incremental extraction during fetch
      const postTexts = new Map<string, PostTextContent>();
      const uniqueCandidates = new Set<string>();
      let rootAtUri = '';
      let rootTextLower = '';

      // Callback processes posts as they arrive, overlapping extraction with fetching
      const processPostsBatch = (posts: readonly PostView[]) => {
        for (const post of posts) {
          if (postTexts.has(post.uri)) continue;
          const textContent = extractPostText(post);
          postTexts.set(post.uri, textContent);

          // First post processed becomes root
          if (rootAtUri === '') {
            rootAtUri = post.uri;
            rootTextLower = post.record.text.toLowerCase();
            continue; // Skip root for candidate extraction
          }

          // Extract candidates incrementally
          let searchText = textContent.ownText;
          if (textContent.quotedText && textContent.quotedUri !== rootAtUri) {
            searchText += '\n' + textContent.quotedText;
          }
          if (textContent.quotedAltText) {
            searchText += '\n' + textContent.quotedAltText.join('\n');
          }

          for (const c of extractCandidates(searchText)) {
            uniqueCandidates.add(c);
          }
          const shortCandidate = extractShortTextCandidate(post.record.text);
          if (shortCandidate) uniqueCandidates.add(shortCandidate);
        }
      };

      const allPosts = await this.fetchAllPostsRecursively(atUri, processPostsBatch);

      this.progressTracker.emit('fetching', { fetched: allPosts.length, stage: 'recursive' });

      console.log(`[Analysis] Processing ${allPosts.length} total posts`);

      const rootPost = allPosts[0];
      if (!rootPost) {
        throw new Error('no posts found in thread');
      }

      console.log(`[Analysis] Found ${uniqueCandidates.size} unique candidates`);

      // Stage 4: Validate unique candidates — three tiers
      const candidateArray = [...uniqueCandidates];
      const customList = this.getCustomValidationList();

      let validationLookup: Map<string, import('./lib/thread-dictionary').ValidationLookupEntry>;

      if (selectedTypes.length > 0) {
        // Tier 1: API validation (external APIs checked)
        this.progressTracker.emit('validating', { validated: 0, total: candidateArray.length });

        const candidateMentions: MediaMention[] = candidateArray.map((title) => {
          const mediaType =
            selectedTypes.length === 1 && selectedTypes[0]
              ? (selectedTypes[0] as MediaMention['mediaType'])
              : ('UNKNOWN' as MediaMention['mediaType']);
          return {
            title,
            normalizedTitle: title.toLowerCase(),
            mediaType,
            confidence: 'medium' as const,
          };
        });

        const validationClient = new ValidationClient({
          apiUrl: '/api/validate',
          onProgress: (progress) => {
            this.progressTracker.emit('validating', {
              validated: progress.completed,
              total: progress.total,
            });
          },
        });

        const validatedMentions = await validationClient.validateMentions(candidateMentions);
        validationLookup = buildValidationLookup(validatedMentions);

        console.log(
          `[Analysis] API-validated ${validationLookup.size} candidates out of ${candidateArray.length}`
        );
      } else if (customList.length > 0) {
        // Tier 2: List validation (user pasted a list)
        this.progressTracker.emit('validating', {
          validated: candidateArray.length,
          total: candidateArray.length,
        });

        validationLookup = buildListValidatedLookup(uniqueCandidates, customList);

        console.log(
          `[Analysis] List-validated ${validationLookup.size} candidates against ${customList.length} list items`
        );
      } else {
        // Tier 3: Self-validation (structural heuristics)
        this.progressTracker.emit('validating', {
          validated: candidateArray.length,
          total: candidateArray.length,
        });

        validationLookup = buildSelfValidatedLookup(uniqueCandidates, rootTextLower);

        console.log(
          `[Analysis] Self-validated ${validationLookup.size} candidates out of ${candidateArray.length}`
        );
      }

      // Stage 5: Build dictionary (Phase 1)
      this.progressTracker.emit('counting', {});

      // List-validated threads relax the short-title threshold because
      // the user's list already confirms entries. Self-validated threads
      // require 2+ confident mentions to reduce noise from common words.
      // API-validated threads use defaults.
      const isListValidated = selectedTypes.length === 0 && customList.length > 0;
      const isSelfValidated = selectedTypes.length === 0 && customList.length === 0;
      const dictionaryOptions = isListValidated
        ? { minConfidentForShortTitle: 1 }
        : isSelfValidated
          ? { minConfidentOverall: 2 }
          : undefined;
      const dictionary = discoverDictionary(
        allPosts,
        postTexts,
        validationLookup,
        rootAtUri,
        rootTextLower,
        dictionaryOptions
      );

      console.log(`[Analysis] Dictionary: ${dictionary.entries.size} titles discovered`);
      for (const [title, info] of [...dictionary.entries]
        .sort((a, b) => b[1].frequency - a[1].frequency)
        .slice(0, 15)) {
        console.log(
          `  ${title.padEnd(45)} ${String(info.confidentCount).padStart(3)} confident, ${String(info.incidentalCount).padStart(3)} incidental`
        );
      }

      // Stage 6: Label posts (Phase 2)
      const postToTitles = labelPosts(
        allPosts,
        postTexts,
        dictionary,
        validationLookup,
        rootAtUri,
        rootTextLower
      );

      // Stage 7: Build MentionCount[] from postToTitles
      const titleCounts = new Map<string, PostView[]>();
      for (const [postUri, titles] of postToTitles) {
        const post = allPosts.find((p) => p.uri === postUri);
        if (!post) continue;
        for (const title of titles) {
          const existing = titleCounts.get(title);
          if (existing) {
            existing.push(post);
          } else {
            titleCounts.set(title, [post]);
          }
        }
      }

      const finalMentionCounts: MentionCount[] = [...titleCounts.entries()]
        .map(([title, posts]) => ({
          mention: title,
          count: posts.length,
          posts,
        }))
        .sort((a, b) => b.count - a.count);

      // Find uncategorized posts
      const uncategorizedPosts = allPosts.filter(
        (post) => post.uri !== rootAtUri && !postToTitles.has(post.uri)
      );

      // Stage 8: Display results
      this.progressTracker.emit('complete', { mentionCounts: finalMentionCounts });

      this.showResults(finalMentionCounts, allPosts.length, uncategorizedPosts);
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
   * Recursively fetch all posts: thread replies, quotes, and their nested content
   * @param uri - Starting post URI (can be handle-based or DID-based)
   * @param visited - Set of already-visited URIs to avoid loops
   * @param depth - Current recursion depth (max 5 to prevent runaway)
   */
  private async fetchAllPostsRecursively(
    uri: string,
    onPostsBatch?: (posts: readonly PostView[]) => void,
    visited: Set<string> = new Set(),
    depth: number = 0
  ): Promise<PostView[]> {
    const MAX_DEPTH = 5;
    if (depth > MAX_DEPTH || visited.has(uri)) {
      console.log(
        `[fetchAllPosts] Skipping uri=${uri} (depth=${depth}, visited=${visited.has(uri)})`
      );
      return [];
    }
    visited.add(uri);

    console.log(`[fetchAllPosts] Fetching uri=${uri} at depth=${depth}`);

    const allPosts: PostView[] = [];
    let didBasedUri = uri; // Will be updated to DID-based URI from thread response

    // Fetch the thread (includes nested replies) with high depth to capture full conversation
    const threadResult = await this.blueskyClient.getPostThread(uri, {
      depth: 1000,
      parentHeight: 1000,
    });
    if (threadResult.ok) {
      const tree = this.threadBuilder.buildTree(threadResult.value.thread);
      console.log(
        `[fetchAllPosts] Thread returned ${tree.allPosts.length} posts, ${tree.truncatedPosts.length} truncated, ${tree.restrictedPosts.length} restricted`
      );
      if (tree.restrictedPosts.length > 0) {
        console.log(
          `[fetchAllPosts] ${tree.restrictedPosts.length} posts require authentication to view`
        );
      }
      allPosts.push(...tree.allPosts);
      onPostsBatch?.(tree.allPosts);
      this.progressTracker.emit('fetching', { fetched: allPosts.length, stage: 'thread' });

      // Get the DID-based URI from the root post (getQuotes requires DID-based URIs)
      if (tree.post?.uri) {
        didBasedUri = tree.post.uri;
        console.log(`[fetchAllPosts] Resolved to DID-based URI: ${didBasedUri}`);

        // Store the original (root) post for display at depth 0
        if (depth === 0) {
          this.originalPost = tree.post;
        }
      }

      // Mark all thread posts as visited (using their DID-based URIs)
      for (const post of tree.allPosts) {
        visited.add(post.uri);
      }

      // Fetch subtrees for truncated posts (posts where API didn't return all replies)
      if (tree.truncatedPosts.length > 0) {
        this.progressTracker.emit('fetching', { fetched: allPosts.length, stage: 'truncated' });
        console.log(`[fetchAllPosts] Fetching ${tree.truncatedPosts.length} truncated subtrees`);
        for (const truncated of tree.truncatedPosts) {
          const missingCount = truncated.expectedReplies - truncated.actualReplies;
          console.log(
            `[fetchAllPosts] Truncated post ${truncated.uri}: expected=${truncated.expectedReplies}, got=${truncated.actualReplies}, missing=${missingCount}`
          );
        }

        // Fetch truncated subtrees in parallel batches
        const TRUNCATED_BATCH_SIZE = 10;
        for (let i = 0; i < tree.truncatedPosts.length; i += TRUNCATED_BATCH_SIZE) {
          const batch = tree.truncatedPosts.slice(i, i + TRUNCATED_BATCH_SIZE);
          const results = await Promise.allSettled(
            batch.map((truncated) => this.fetchTruncatedSubtree(truncated.uri, visited))
          );
          for (const result of results) {
            if (result.status === 'fulfilled' && result.value.length > 0) {
              console.log(
                `[fetchAllPosts] Fetched ${result.value.length} additional posts from truncated subtree`
              );
              allPosts.push(...result.value);
              onPostsBatch?.(result.value);
            }
          }
          this.progressTracker.emit('fetching', { fetched: allPosts.length, stage: 'truncated' });
        }
      }
    } else {
      console.log(`[fetchAllPosts] Thread fetch failed:`, threadResult.error);
    }

    // Fetch ALL quote posts using pagination (required DID-based URI)
    console.log(`[fetchAllPosts] Fetching quotes for DID-based uri=${didBasedUri}`);
    this.progressTracker.emit('fetching', { fetched: allPosts.length, stage: 'quotes' });
    let cursor: string | undefined;
    let totalQuotesFetched = 0;
    let newQuotesAdded = 0;

    do {
      const quotesResult = await this.blueskyClient.getQuotes(didBasedUri, { cursor, limit: 100 });
      if (!quotesResult.ok) {
        console.log(`[fetchAllPosts] Quotes fetch failed:`, quotesResult.error);
        break;
      }

      const quotes = quotesResult.value.posts;
      cursor = quotesResult.value.cursor;
      totalQuotesFetched += quotes.length;

      console.log(
        `[fetchAllPosts] Quotes page returned ${quotes.length} posts (total fetched: ${totalQuotesFetched}, cursor: ${cursor ? 'yes' : 'no'})`
      );

      // Collect unvisited quotes from this page
      const unvisitedQuotes = quotes.filter((quote) => !visited.has(quote.uri));

      // Add quote posts immediately
      for (const quote of unvisitedQuotes) {
        newQuotesAdded++;
        allPosts.push(quote);
        visited.add(quote.uri);
      }
      if (unvisitedQuotes.length > 0) {
        onPostsBatch?.(unvisitedQuotes);
      }

      // Update progress
      this.progressTracker.emit('fetching', { fetched: allPosts.length, stage: 'quotes' });

      // Fetch quote threads in parallel batches
      const QUOTE_BATCH_SIZE = 10;
      for (let i = 0; i < unvisitedQuotes.length; i += QUOTE_BATCH_SIZE) {
        const batch = unvisitedQuotes.slice(i, i + QUOTE_BATCH_SIZE);

        console.log(
          `[fetchAllPosts] Fetching ${batch.length} quote threads in parallel (batch ${Math.floor(i / QUOTE_BATCH_SIZE) + 1})`
        );

        const threadResults = await Promise.allSettled(
          batch.map((quote) =>
            this.blueskyClient.getPostThread(quote.uri, { depth: 1000, parentHeight: 0 })
          )
        );

        // Process results
        for (let j = 0; j < threadResults.length; j++) {
          const result = threadResults[j];
          if (result && result.status === 'fulfilled' && result.value.ok) {
            const quoteTree = this.threadBuilder.buildTree(result.value.value.thread);
            const newPosts: PostView[] = [];

            // Add only posts not already visited
            for (const post of quoteTree.allPosts) {
              if (!visited.has(post.uri)) {
                allPosts.push(post);
                visited.add(post.uri);
                newPosts.push(post);
              }
            }

            if (newPosts.length > 0) {
              console.log(`[fetchAllPosts] Quote thread added ${newPosts.length} reply posts`);
              onPostsBatch?.(newPosts);
            }
          }
        }

        // Update progress after each batch
        this.progressTracker.emit('fetching', { fetched: allPosts.length, stage: 'quotes' });
      }
    } while (cursor);

    console.log(
      `[fetchAllPosts] Total quotes fetched: ${totalQuotesFetched}, new quotes added: ${newQuotesAdded}`
    );

    // === Recursive QT crawl: fetch QTs of replies, QTs of QTs, etc. ===
    // Posts with quoteCount > 0 may have their own QTs that the initial fetch missed.
    this.progressTracker.emit('fetching', { fetched: allPosts.length, stage: 'recursive' });
    const MIN_REPOSTS_FOR_QT_FETCH = 3;
    const MAX_QT_DEPTH = 10; // configurable cap — see note below
    let recursiveQtCount = 0;
    let depthCapHits = 0;
    const fetchedQtSources = new Set([didBasedUri]);

    type QueueItem = { uri: string; depth: number; quoteCount: number };
    const qtQueue: QueueItem[] = allPosts
      .filter(
        (p) => (p.quoteCount ?? 0) >= MIN_REPOSTS_FOR_QT_FETCH && !fetchedQtSources.has(p.uri)
      )
      .map((p) => ({ uri: p.uri, depth: 1, quoteCount: p.quoteCount ?? 0 }));

    console.log(
      `[fetchAllPosts] Recursive QT crawl: ${qtQueue.length} posts with ${MIN_REPOSTS_FOR_QT_FETCH}+ quotes to check`
    );

    const QT_CRAWL_BATCH_SIZE = 5;
    while (qtQueue.length > 0) {
      // Drain up to QT_CRAWL_BATCH_SIZE eligible items from the queue
      const batch: QueueItem[] = [];
      while (batch.length < QT_CRAWL_BATCH_SIZE && qtQueue.length > 0) {
        const item = qtQueue.shift()!;
        if (fetchedQtSources.has(item.uri)) continue;
        if (item.depth > MAX_QT_DEPTH) {
          depthCapHits++;
          console.log(
            `[fetchAllPosts] Depth cap hit (depth=${item.depth}, quoteCount=${item.quoteCount}, uri=${item.uri})`
          );
          continue;
        }
        fetchedQtSources.add(item.uri);
        batch.push(item);
      }
      if (batch.length === 0) continue;

      console.log(
        `[fetchAllPosts] QT crawl: fetching quotes for ${batch.length} posts in parallel`
      );

      // Fetch QTs for all batch items in parallel (each may paginate)
      const batchQtResults = await Promise.allSettled(
        batch.map(async (item) => {
          const newQts: PostView[] = [];
          let qtCursor: string | undefined;
          do {
            const quotesResult = await this.blueskyClient.getQuotes(item.uri, {
              cursor: qtCursor,
              limit: 100,
            });
            if (!quotesResult.ok) break;
            qtCursor = quotesResult.value.cursor;
            for (const quote of quotesResult.value.posts) {
              if (!visited.has(quote.uri)) {
                visited.add(quote.uri);
                newQts.push(quote);
              }
            }
          } while (qtCursor);
          return { item, newQts };
        })
      );

      // Collect all new QTs and add to allPosts
      const allNewQts: { item: QueueItem; qts: PostView[] }[] = [];
      for (const result of batchQtResults) {
        if (result.status === 'fulfilled') {
          const { item, newQts } = result.value;
          if (newQts.length > 0) {
            console.log(`[fetchAllPosts]   [depth=${item.depth}] Found ${newQts.length} new QTs`);
          }
          allPosts.push(...newQts);
          onPostsBatch?.(newQts);
          recursiveQtCount += newQts.length;
          allNewQts.push({ item, qts: newQts });
        }
      }

      // Fetch reply threads for all new QTs in parallel batches
      const REPLY_BATCH_SIZE = 10;
      const allQtPosts = allNewQts.flatMap(({ item, qts }) =>
        qts.map((qt) => ({ qt, depth: item.depth }))
      );

      for (let i = 0; i < allQtPosts.length; i += REPLY_BATCH_SIZE) {
        const replyBatch = allQtPosts.slice(i, i + REPLY_BATCH_SIZE);
        const replyResults = await Promise.allSettled(
          replyBatch
            .filter(({ qt }) => (qt.replyCount ?? 0) > 0)
            .map(({ qt }) =>
              this.blueskyClient.getPostThread(qt.uri, { depth: 1000, parentHeight: 0 })
            )
        );

        for (const result of replyResults) {
          if (result.status === 'fulfilled' && result.value.ok) {
            const tree = this.threadBuilder.buildTree(result.value.value.thread);
            const newPosts: PostView[] = [];
            for (const post of tree.allPosts) {
              if (!visited.has(post.uri)) {
                allPosts.push(post);
                visited.add(post.uri);
                newPosts.push(post);
                recursiveQtCount++;

                if (
                  (post.quoteCount ?? 0) >= MIN_REPOSTS_FOR_QT_FETCH &&
                  !fetchedQtSources.has(post.uri)
                ) {
                  qtQueue.push({
                    uri: post.uri,
                    depth: replyBatch[0]!.depth + 1,
                    quoteCount: post.quoteCount ?? 0,
                  });
                }
              }
            }
            if (newPosts.length > 0) {
              onPostsBatch?.(newPosts);
            }
          }
        }
      }

      // Queue the QTs themselves for further QT fetching
      for (const { item, qts } of allNewQts) {
        for (const qt of qts) {
          if ((qt.quoteCount ?? 0) >= MIN_REPOSTS_FOR_QT_FETCH && !fetchedQtSources.has(qt.uri)) {
            qtQueue.push({
              uri: qt.uri,
              depth: item.depth + 1,
              quoteCount: qt.quoteCount ?? 0,
            });
          }
        }
      }

      this.progressTracker.emit('fetching', { fetched: allPosts.length, stage: 'recursive' });
    }

    console.log(`[fetchAllPosts] Recursive QT crawl added ${recursiveQtCount} posts`);
    if (depthCapHits > 0) {
      console.log(
        `[fetchAllPosts] ⚠ Depth cap (${MAX_QT_DEPTH}) was hit ${depthCapHits} time(s) — some content may have been missed`
      );
    }

    return allPosts;
  }

  /**
   * Fetch a subtree for a truncated post (where API didn't return all replies)
   * Only returns posts not already in visited set
   */
  private async fetchTruncatedSubtree(uri: string, visited: Set<string>): Promise<PostView[]> {
    // Fetch the thread rooted at this post
    const threadResult = await this.blueskyClient.getPostThread(uri, {
      depth: 1000,
      parentHeight: 0,
    });
    if (!threadResult.ok) {
      console.log(`[fetchTruncatedSubtree] Failed to fetch ${uri}:`, threadResult.error);
      return [];
    }

    const tree = this.threadBuilder.buildTree(threadResult.value.thread);

    // Filter to only new posts
    const newPosts: PostView[] = [];
    for (const post of tree.allPosts) {
      if (!visited.has(post.uri)) {
        newPosts.push(post);
        visited.add(post.uri);
      }
    }

    console.log(
      `[fetchTruncatedSubtree] Found ${newPosts.length} new posts out of ${tree.allPosts.length} total`
    );

    // Check for further truncation in this subtree
    if (tree.truncatedPosts.length > 0) {
      console.log(
        `[fetchTruncatedSubtree] Subtree has ${tree.truncatedPosts.length} more truncated posts`
      );
      for (const truncated of tree.truncatedPosts) {
        // Only fetch if we haven't already fetched this post's full subtree
        if (!visited.has(`${truncated.uri}:fetched`)) {
          visited.add(`${truncated.uri}:fetched`);
          const morePosts = await this.fetchTruncatedSubtree(truncated.uri, visited);
          newPosts.push(...morePosts);
        }
      }
    }

    return newPosts;
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
