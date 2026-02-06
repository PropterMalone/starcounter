import { BlueskyClient, AuthService } from './api';
import { ThreadBuilder, MentionExtractor, MentionCounter, decodeResults } from './lib';
import { ProgressTracker } from './lib/progress-tracker';
import { createSentimentAnalyzer } from './lib/sentiment-factory';
import { ValidationClient } from './lib/validation-client';
import {
  InputForm,
  ProgressBar,
  ResultsChart,
  DrillDownModal,
  ShareButton,
  AdvancedToggle,
  LoginForm,
} from './components';
import type { MentionCount, PostView } from './types';
import type { MediaMention } from './lib/mention-extractor';

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
  private authService: AuthService;
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
  private analysisStartTime: number = 0;
  private originalPost: PostView | null = null;

  // State for re-rendering with uncategorized toggle
  private lastMentionCounts: MentionCount[] = [];
  private lastUncategorizedPosts: PostView[] = [];

  // User refinement state
  private excludedCategories: Set<string> = new Set();
  private manualAssignments: Map<string, string> = new Map(); // postUri → category

  constructor() {
    // Initialize auth service first
    this.authService = new AuthService();

    // Initialize backend services
    this.blueskyClient = new BlueskyClient();
    this.threadBuilder = new ThreadBuilder();
    this.mentionExtractor = new MentionExtractor();
    this.counter = new MentionCounter();
    this.progressTracker = new ProgressTracker();

    // Sync auth state with BlueskyClient
    const session = this.authService.getSession();
    if (session) {
      this.blueskyClient.setAccessToken(session.accessJwt);
    }

    // Listen for auth changes
    this.authService.onSessionChange((newSession) => {
      this.blueskyClient.setAccessToken(newSession?.accessJwt ?? null);
    });

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

    this.shareButton = new ShareButton(
      requireElement<HTMLButtonElement>('share-button'),
      requireElement<HTMLElement>('share-feedback'),
      requireElement<HTMLElement>('share-feedback-text')
    );

    this.advancedToggle = new AdvancedToggle(
      requireElement<HTMLInputElement>('advanced-mode'),
      requireElement<HTMLSpanElement>('advanced-status')
    );

    // Track advanced mode state
    this.useAdvancedSentiment = this.advancedToggle.isEnabled();
    this.advancedToggle.onChange((enabled) => {
      this.useAdvancedSentiment = enabled;
    });

    // Initialize login form (creates UI elements, no need to store reference)
    const loginContainer = document.getElementById('login-container');
    if (loginContainer) {
      new LoginForm(loginContainer, this.authService);
    }

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

    // Progress tracker events (type-safe - data is correctly typed for each event)
    this.progressTracker.on('fetching', (data) => {
      this.progressBar.updateFetching(data.fetched, data.total);
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
      this.analysisStartTime = Date.now();
      this.originalPost = null;

      // Reset user refinement state
      this.excludedCategories.clear();
      this.manualAssignments.clear();

      // Extract AT-URI from bsky.app URL
      const atUri = this.convertBskyUrlToAtUri(url);

      // Stage 1: Fetch thread and quotes recursively
      this.progressTracker.emit('fetching', { fetched: 0, total: 0 });

      const allPosts = await this.fetchAllPostsRecursively(atUri);

      this.progressTracker.emit('fetching', { fetched: allPosts.length, total: allPosts.length });

      // Stage 2: Extract mentions
      this.progressTracker.emit('extracting', {});

      // Get user-selected media types
      const selectedTypes = this.getSelectedMediaTypes();

      console.log(`[Analysis] Processing ${allPosts.length} total posts`);

      // Extract mentions and track which post each came from
      type MentionWithSource = MediaMention & { sourcePost: PostView };
      const mentionsWithSource: MentionWithSource[] = allPosts.flatMap((post) =>
        this.mentionExtractor.extractMentions(post.record.text).map((m) => ({
          ...m,
          sourcePost: post,
        }))
      );

      console.log(
        `[Analysis] Extracted ${mentionsWithSource.length} raw mentions:`,
        mentionsWithSource.map((m) => m.title)
      );

      // Create a map from normalized title to source posts (for drilldown later)
      const titleToSourcePosts = new Map<string, PostView[]>();
      for (const m of mentionsWithSource) {
        const existing = titleToSourcePosts.get(m.normalizedTitle);
        if (existing) {
          // Only add if not already in the list (same post can have multiple mentions of same title)
          if (!existing.some((p) => p.uri === m.sourcePost.uri)) {
            existing.push(m.sourcePost);
          }
        } else {
          titleToSourcePosts.set(m.normalizedTitle, [m.sourcePost]);
        }
      }

      // For backward compatibility, also create mentions array without source
      const mentions = mentionsWithSource.map(({ sourcePost: _sourcePost, ...m }) => m);

      // Override media types based on user selection
      // If user selected specific types, force all mentions to use those types for validation
      const processedMentions = mentions.map((mention) => {
        // If only one type selected, force all mentions to that type
        if (selectedTypes.length === 1 && selectedTypes[0]) {
          return { ...mention, mediaType: selectedTypes[0] as MediaMention['mediaType'] };
        }
        // If multiple types selected and mention type matches one, keep it
        if (selectedTypes.includes(mention.mediaType)) {
          return mention;
        }
        // If mention type doesn't match selection (e.g., UNKNOWN), default to first selected
        if (selectedTypes[0]) {
          return { ...mention, mediaType: selectedTypes[0] as MediaMention['mediaType'] };
        }
        return mention;
      });

      // Stage 3: Count mentions (with appropriate sentiment analyzer)
      this.progressTracker.emit('counting', {});

      // Set the appropriate sentiment analyzer based on user preference
      const analyzer = createSentimentAnalyzer(this.useAdvancedSentiment);
      this.counter.setSentimentAnalyzer(analyzer);

      // Create a minimal tree stub for counting (branch/sentiment analysis disabled for now)
      // TODO: Build proper tree from recursively fetched posts
      const firstPost = allPosts[0];
      if (!firstPost) {
        throw new Error('no posts found in thread');
      }
      const stubTree = {
        post: firstPost,
        branches: [],
        allPosts,
        truncatedPosts: [],
        restrictedPosts: [],
        getParent: () => null,
        getBranchAuthors: () => [],
        flattenPosts: () => allPosts,
      };
      const countMap = await this.counter.countMentions(processedMentions, allPosts, stubTree);
      // Note: mentionCounts used for unvalidated results, validatedCountMap used for validated
      void this.buildMentionCounts(countMap, allPosts);

      // Stage 4: Validate mentions against TMDB/MusicBrainz
      this.progressTracker.emit('validating', { validated: 0, total: processedMentions.length });

      const validationClient = new ValidationClient({
        apiUrl: '/api/validate',
        onProgress: (progress) => {
          this.progressTracker.emit('validating', {
            validated: progress.completed,
            total: progress.total,
          });
        },
      });

      const validatedMentions = await validationClient.validateMentions(processedMentions);

      // Filter to only validated mentions and rebuild counts
      const validMentions = validatedMentions.filter(
        (m) => m.validated && m.validationConfidence !== 'low'
      );

      // Recount with validated mentions only (use validated titles)
      const validatedCountMap = new Map<string, { count: number; mentions: MediaMention[] }>();
      for (const mention of validMentions) {
        const title = mention.validatedTitle || mention.title;
        const existing = validatedCountMap.get(title);
        if (existing) {
          existing.count++;
          existing.mentions.push(mention);
        } else {
          validatedCountMap.set(title, { count: 1, mentions: [mention] });
        }
      }

      // Helper to normalize text for matching: lowercase and convert & to "and"
      const normalizeForSearch = (text: string) => text.toLowerCase().replace(/\s*&\s*/g, ' and ');

      // Helper to check if text contains a search term with word boundaries
      const textContainsTerm = (text: string, term: string): boolean => {
        // Always use word boundary matching to avoid partial matches
        const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        return pattern.test(text);
      };

      // Known phrases where a short word is part of a longer movie title
      // Maps short word → patterns that indicate it's part of a longer title (regex fragments)
      const shortWordPhrasePatterns: Record<string, RegExp[]> = {
        red: [
          /\bred\s+october\b/i, // Hunt for Red October
          /\bfor\s+red\b/i, // "hunt FOR RED october"
          /\bred\s+dragon\b/i, // Red Dragon
          /\bred\s+dawn\b/i, // Red Dawn
          /\bred\s+sparrow\b/i, // Red Sparrow
        ],
        jones: [
          /\bindiana\s+jones\b/i, // Indiana Jones
          /\bjones\s+and\s+the\b/i, // "Jones and the..."
          /\bbridget\s+jones\b/i, // Bridget Jones
        ],
        ugly: [
          /\bgood[,]?\s*(the\s+)?bad[,]?\s*(and\s+)?(the\s+)?ugly\b/i, // The Good, the Bad and the Ugly
          /\bbad\s+(and\s+)?(the\s+)?ugly\b/i,
        ],
        oceans: [
          /\bocean'?s?\s+(eleven|twelve|thirteen|8|eight)\b/i, // Ocean's Eleven/Twelve/etc
        ],
        ocean: [/\bocean'?s?\s+(eleven|twelve|thirteen|8|eight)\b/i],
      };

      // Check if a short word appears ONLY in known phrase patterns (not standalone)
      const isWordOnlyInPhrases = (text: string, word: string): boolean => {
        const lowerWord = word.toLowerCase();
        const patterns = shortWordPhrasePatterns[lowerWord];
        if (!patterns) return false; // No known patterns, assume standalone

        const lowerText = text.toLowerCase();

        // Check if the word appears in any of the known phrase patterns
        const appearsInPhrase = patterns.some((pattern) => pattern.test(lowerText));
        if (!appearsInPhrase) return false; // Word doesn't appear in any known phrase

        // Check if word appears OUTSIDE of the phrase patterns (standalone)
        // Remove all phrase matches and see if word still appears
        let textWithoutPhrases = lowerText;
        for (const pattern of patterns) {
          textWithoutPhrases = textWithoutPhrases.replace(pattern, ' ');
        }

        // Check if word still appears after removing phrase matches
        const wordPattern = new RegExp(`\\b${lowerWord}\\b`, 'i');
        const stillAppears = wordPattern.test(textWithoutPhrases);

        // If word only appeared in phrases (not standalone), return true
        return !stillAppears;
      };

      // Merge validated titles where one is a substring of another
      // E.g., "Red" should merge into "The Hunt for Red October"
      const mergedValidatedCountMap = this.mergeSubstringTitles(validatedCountMap);

      // Build a map of all validated titles and their search terms
      // This is needed to detect when a short title is part of a longer title
      const allTitleSearchTerms = new Map<string, Set<string>>();
      for (const [title, data] of mergedValidatedCountMap.entries()) {
        const searchTerms = new Set<string>();
        for (const m of data.mentions) {
          searchTerms.add(normalizeForSearch(m.title));
        }
        const normalizedTitle = normalizeForSearch(title);
        searchTerms.add(normalizedTitle);
        if (normalizedTitle.includes(':')) {
          const baseTitle = normalizedTitle.split(':')[0]?.trim() ?? '';
          const wordCount = baseTitle.split(/\s+/).length;
          if (wordCount >= 2 || baseTitle.length >= 10) {
            searchTerms.add(baseTitle);
          }
        }
        allTitleSearchTerms.set(title, searchTerms);
      }

      // For each post, find which titles it matches, preferring longer/more specific matches
      // This prevents "red october" from counting as both "RED" and "Hunt for Red October"
      const postToTitles = new Map<string, Set<string>>();
      for (const post of allPosts) {
        const text = normalizeForSearch(post.record.text);
        const matchedTitles: string[] = [];

        // Find all titles this post matches
        for (const [title, searchTerms] of allTitleSearchTerms.entries()) {
          if (Array.from(searchTerms).some((term) => textContainsTerm(text, term))) {
            matchedTitles.push(title);
          }
        }

        // Filter out titles whose search terms are substrings of other matched titles' terms
        // E.g., if post matches both "RED" and "Hunt for Red October", keep only the longer one
        const filteredTitles = matchedTitles.filter((title) => {
          const myTerms = allTitleSearchTerms.get(title)!;
          const myLongestTerm = Array.from(myTerms).reduce(
            (a, b) => (a.length > b.length ? a : b),
            ''
          );

          // Check if this title's terms are substrings of another matched title's terms
          for (const otherTitle of matchedTitles) {
            if (otherTitle === title) continue;
            const otherTerms = allTitleSearchTerms.get(otherTitle)!;

            // If any of the other title's terms contain our longest term, skip this title
            for (const otherTerm of otherTerms) {
              if (otherTerm.length > myLongestTerm.length && otherTerm.includes(myLongestTerm)) {
                return false; // Our term is a substring of a longer matched title
              }
            }
          }

          // For single-word titles that are known to appear in longer movie titles
          // (like RED in "Red October", JONES in "Indiana Jones"), check if the word
          // ONLY appears as part of those longer titles. If so, skip counting.
          const isSingleWord = !myLongestTerm.includes(' ');
          if (isSingleWord) {
            // Check if this word only appears in known phrase patterns
            if (isWordOnlyInPhrases(post.record.text, myLongestTerm)) {
              return false; // Word only appears as part of longer movie title phrases
            }
          }

          return true;
        });

        postToTitles.set(post.uri, new Set(filteredTitles));
      }

      // Build mention counts from validated results
      const validatedMentionCounts: MentionCount[] = [];
      for (const [title] of mergedValidatedCountMap.entries()) {
        // Find posts that match this title (after filtering out substring matches)
        const contributingPosts = allPosts.filter((post) => {
          const titles = postToTitles.get(post.uri);
          return titles?.has(title) ?? false;
        });

        // Use the number of matching posts as the count, not just extracted mentions
        // This ensures lowercase mentions like "hunt for red october" are counted
        validatedMentionCounts.push({
          mention: title,
          count: contributingPosts.length,
          posts: contributingPosts,
        });
      }

      // Sort by count descending
      validatedMentionCounts.sort((a, b) => b.count - a.count);

      // Only use validated results - don't fall back to unvalidated cruft
      const finalMentionCounts = validatedMentionCounts;

      // Find posts that didn't contribute to ANY category (for debug)
      const uncategorizedPosts = allPosts.filter((post) => {
        const titles = postToTitles.get(post.uri);
        return !titles || titles.size === 0;
      });

      // Stage 5: Display results
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
    // Store state for re-rendering with toggle
    this.lastMentionCounts = mentionCounts;
    this.lastUncategorizedPosts = uncategorizedPosts ?? [];

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
    this.shareButton.setResults(mentionCounts); // Share excludes uncategorized
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
      return 'This post may be private or restricted. Try logging in with your Bluesky account.';
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
        console.log(`[fetchAllPosts] Fetching ${tree.truncatedPosts.length} truncated subtrees`);
        for (const truncated of tree.truncatedPosts) {
          const missingCount = truncated.expectedReplies - truncated.actualReplies;
          console.log(
            `[fetchAllPosts] Truncated post ${truncated.uri}: expected=${truncated.expectedReplies}, got=${truncated.actualReplies}, missing=${missingCount}`
          );

          // Fetch this post's thread to get its missing replies
          // Note: we use depth + 1 to track overall recursion, but this is a sibling fetch, not a deeper nesting
          const subtreePosts = await this.fetchTruncatedSubtree(truncated.uri, visited);
          if (subtreePosts.length > 0) {
            console.log(
              `[fetchAllPosts] Fetched ${subtreePosts.length} additional posts from truncated subtree`
            );
            allPosts.push(...subtreePosts);
          }
        }
      }
    } else {
      console.log(`[fetchAllPosts] Thread fetch failed:`, threadResult.error);
    }

    // Fetch ALL quote posts using pagination (required DID-based URI)
    console.log(`[fetchAllPosts] Fetching quotes for DID-based uri=${didBasedUri}`);
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

      // Update progress
      this.progressTracker.emit('fetching', { fetched: allPosts.length, total: allPosts.length });

      // Fetch quote threads in parallel batches (5 concurrent to avoid rate limits)
      const QUOTE_BATCH_SIZE = 5;
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
            let newReplyCount = 0;

            // Add only posts not already visited
            for (const post of quoteTree.allPosts) {
              if (!visited.has(post.uri)) {
                allPosts.push(post);
                visited.add(post.uri);
                newReplyCount++;
              }
            }

            if (newReplyCount > 0) {
              console.log(`[fetchAllPosts] Quote thread added ${newReplyCount} reply posts`);
            }
          }
        }

        // Update progress after each batch
        this.progressTracker.emit('fetching', { fetched: allPosts.length, total: allPosts.length });
      }
    } while (cursor);

    console.log(
      `[fetchAllPosts] Total quotes fetched: ${totalQuotesFetched}, new quotes added: ${newQuotesAdded}`
    );

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
    const types = Array.from(checkboxes).map((cb) => cb.value);
    // Default to all types if none selected
    return types.length > 0 ? types : ['MOVIE', 'TV_SHOW', 'MUSIC'];
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
   * Merge validated titles where one is a word-bounded substring of another.
   * E.g., "Red" merges into "The Hunt for Red October" if both exist.
   * This prevents short titles from stealing counts from longer, more specific titles.
   *
   * EXCEPTION: Don't merge when the shorter title is a prefix of a sequel/subtitle.
   * E.g., "Top Gun" should NOT merge into "Top Gun: Maverick" (distinct films).
   */
  private mergeSubstringTitles(
    countMap: Map<string, { count: number; mentions: MediaMention[] }>
  ): Map<string, { count: number; mentions: MediaMention[] }> {
    const titles = Array.from(countMap.keys());

    // Sort by length descending (longest first)
    titles.sort((a, b) => b.length - a.length);

    // Build mapping: short title → canonical (longer) title
    const canonicalMap = new Map<string, string>();

    for (const title of titles) {
      const normalizedTitle = title.toLowerCase();

      // Check if this title is a word-bounded substring of a longer title
      let canonical = title;
      for (const longer of titles) {
        if (longer.length > title.length) {
          const longerNormalized = longer.toLowerCase();

          // Don't merge if short title is a prefix before a colon/number (sequel pattern)
          // E.g., "Top Gun" vs "Top Gun: Maverick" or "Rocky" vs "Rocky II"
          if (this.isSequelPrefix(normalizedTitle, longerNormalized)) {
            continue; // Skip this longer title, keep looking or stay with original
          }

          // Use word boundary to match - "red" should match in "hunt for red october"
          const pattern = new RegExp(
            `\\b${normalizedTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
            'i'
          );
          if (pattern.test(longerNormalized)) {
            canonical = longer;
            break; // Use the longest matching title
          }
        }
      }
      canonicalMap.set(title, canonical);
    }

    // Merge counts into canonical titles
    const merged = new Map<string, { count: number; mentions: MediaMention[] }>();

    for (const [title, data] of countMap.entries()) {
      const canonical = canonicalMap.get(title) ?? title;
      const existing = merged.get(canonical);

      if (existing) {
        // Merge into existing canonical entry
        existing.count += data.count;
        existing.mentions.push(...data.mentions);
      } else {
        // Create new entry (copy to avoid mutating original)
        merged.set(canonical, { count: data.count, mentions: [...data.mentions] });
      }
    }

    return merged;
  }

  /**
   * Check if the shorter title is a prefix of the longer title in a sequel/subtitle pattern.
   * Returns true for cases like:
   * - "Top Gun" vs "Top Gun: Maverick" (colon subtitle)
   * - "Rocky" vs "Rocky II" (roman numeral sequel)
   * - "Alien" vs "Alien 3" (numbered sequel)
   * - "Star Wars" vs "Star Wars: Episode IV" (franchise with subtitle)
   */
  private isSequelPrefix(shorter: string, longer: string): boolean {
    // Check if longer starts with shorter
    if (!longer.startsWith(shorter)) {
      return false;
    }

    // Get the part after the shorter title
    const suffix = longer.slice(shorter.length).trim();

    // If no suffix or suffix is empty, not a sequel pattern
    if (!suffix) {
      return false;
    }

    // Check for sequel/subtitle patterns:
    // - Starts with colon (subtitle): "Top Gun: Maverick"
    // - Starts with roman numeral: "Rocky II", "Star Trek VI"
    // - Starts with number: "Alien 3", "Die Hard 2"
    // - Starts with "Part": "The Godfather Part II"
    const sequelPatterns = [
      /^:/, // Colon subtitle
      /^[IVX]+\b/i, // Roman numerals
      /^\d+/, // Numbers
      /^part\s/i, // "Part X"
      /^chapter\s/i, // "Chapter X"
      /^episode\s/i, // "Episode X"
      /^vol(\.|ume)?\s/i, // "Vol. X" or "Volume X"
    ];

    return sequelPatterns.some((pattern) => pattern.test(suffix));
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
