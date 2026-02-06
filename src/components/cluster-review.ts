import type { PostView } from '../types';
import type { ClusterSuggestion } from '../lib/clustering';

/**
 * Callbacks for cluster review actions
 */
export type ClusterReviewCallbacks = {
  /** Assign all posts in a cluster to the suggested category */
  onAcceptCluster?: (postUris: string[], category: string) => void;
  /** Dismiss a cluster (don't assign) */
  onDismissCluster?: (category: string) => void;
};

/**
 * Data for cluster review modal
 */
export type ClusterData = {
  suggestions: ClusterSuggestion[];
  /** Map of post URI to PostView for rendering */
  postsByUri: ReadonlyMap<string, PostView>;
};

/**
 * Modal for reviewing and accepting cluster suggestions
 * Helps users clean up uncategorized posts by showing similar posts grouped by category
 */
export class ClusterReviewModal {
  /** Element that was focused before modal opened, to restore on close */
  private previouslyFocusedElement: HTMLElement | null = null;

  /** Bound keyboard handler for cleanup */
  private boundKeydownHandler: (e: KeyboardEvent) => void;

  /** Callbacks for user actions */
  private callbacks: ClusterReviewCallbacks = {};

  /** Dismissed clusters (categories user declined) */
  private dismissedClusters: Set<string> = new Set();

  constructor(
    private modal: HTMLElement,
    private modalTitle: HTMLElement,
    private modalBody: HTMLElement,
    private closeButton: HTMLElement
  ) {
    this.boundKeydownHandler = this.handleKeydown.bind(this);
    this.attachEventListeners();
  }

  /**
   * Set callbacks for cluster review actions
   */
  setCallbacks(callbacks: ClusterReviewCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Show modal with cluster suggestions
   */
  show(data: ClusterData): void {
    // Save currently focused element to restore later
    this.previouslyFocusedElement = document.activeElement as HTMLElement;

    // Filter out dismissed clusters
    const activeSuggestions = data.suggestions.filter(
      (s) => !this.dismissedClusters.has(s.suggestedCategory)
    );

    const totalPosts = activeSuggestions.reduce((sum, s) => sum + s.postUris.length, 0);
    this.modalTitle.textContent = `Review Suggestions (${totalPosts} posts in ${activeSuggestions.length} clusters)`;

    this.renderClusters(activeSuggestions, data.postsByUri);
    this.modal.style.display = 'flex';

    // Add keyboard listener for Escape key
    document.addEventListener('keydown', this.boundKeydownHandler);

    // Focus the close button for keyboard accessibility
    this.closeButton.focus();
  }

  /**
   * Hide modal
   */
  hide(): void {
    this.modal.style.display = 'none';

    // Remove keyboard listener
    document.removeEventListener('keydown', this.boundKeydownHandler);

    // Restore focus to previously focused element
    if (this.previouslyFocusedElement) {
      this.previouslyFocusedElement.focus();
      this.previouslyFocusedElement = null;
    }
  }

  /**
   * Reset dismissed clusters (for new analysis)
   */
  reset(): void {
    this.dismissedClusters.clear();
  }

  /**
   * Handle keyboard events (Escape to close)
   */
  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.hide();
    }
  }

  /**
   * Render cluster suggestions
   */
  private renderClusters(
    suggestions: ClusterSuggestion[],
    postsByUri: ReadonlyMap<string, PostView>
  ): void {
    // Clear existing content
    this.modalBody.innerHTML = '';

    if (suggestions.length === 0) {
      const emptyMessage = document.createElement('p');
      emptyMessage.textContent = 'No suggestions available. All posts have been reviewed.';
      emptyMessage.style.textAlign = 'center';
      emptyMessage.style.color = '#5f6368';
      this.modalBody.appendChild(emptyMessage);
      return;
    }

    // Render each cluster
    for (const suggestion of suggestions) {
      const clusterEl = this.createClusterElement(suggestion, postsByUri);
      this.modalBody.appendChild(clusterEl);
    }
  }

  /**
   * Create HTML element for a cluster suggestion
   */
  private createClusterElement(
    suggestion: ClusterSuggestion,
    postsByUri: ReadonlyMap<string, PostView>
  ): HTMLElement {
    const div = document.createElement('div');
    div.className = 'cluster-item';
    div.dataset['category'] = suggestion.suggestedCategory;

    // Header with category and stats
    const header = document.createElement('div');
    header.className = 'cluster-header';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'cluster-title';
    titleSpan.textContent = suggestion.suggestedCategory;

    const statsSpan = document.createElement('span');
    statsSpan.className = 'cluster-stats';
    const confidencePercent = Math.round(suggestion.score * 100);
    statsSpan.textContent = `${suggestion.postUris.length} posts \u2022 ${confidencePercent}% confidence \u2022 ${suggestion.method}`;

    header.appendChild(titleSpan);
    header.appendChild(statsSpan);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'cluster-actions';

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'btn btn-primary btn-small';
    acceptBtn.textContent = `Assign all ${suggestion.postUris.length} posts`;
    acceptBtn.addEventListener('click', () => {
      this.callbacks.onAcceptCluster?.([...suggestion.postUris], suggestion.suggestedCategory);
      // Remove this cluster from view
      div.remove();
      this.updateAfterChange();
    });

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'btn btn-secondary btn-small';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', () => {
      this.dismissedClusters.add(suggestion.suggestedCategory);
      this.callbacks.onDismissCluster?.(suggestion.suggestedCategory);
      // Remove this cluster from view
      div.remove();
      this.updateAfterChange();
    });

    const expandBtn = document.createElement('button');
    expandBtn.className = 'btn btn-secondary btn-small';
    expandBtn.textContent = 'Show posts';
    expandBtn.addEventListener('click', () => {
      const postsContainer = div.querySelector('.cluster-posts') as HTMLElement;
      if (postsContainer) {
        const isHidden = postsContainer.style.display === 'none';
        postsContainer.style.display = isHidden ? 'block' : 'none';
        expandBtn.textContent = isHidden ? 'Hide posts' : 'Show posts';
      }
    });

    actions.appendChild(acceptBtn);
    actions.appendChild(expandBtn);
    actions.appendChild(dismissBtn);

    // Posts container (hidden by default)
    const postsContainer = document.createElement('div');
    postsContainer.className = 'cluster-posts';
    postsContainer.style.display = 'none';

    for (const uri of suggestion.postUris) {
      const post = postsByUri.get(uri);
      if (post) {
        const postEl = this.createPostPreview(post);
        postsContainer.appendChild(postEl);
      }
    }

    // Assemble
    div.appendChild(header);
    div.appendChild(actions);
    div.appendChild(postsContainer);

    return div;
  }

  /**
   * Create a compact post preview
   */
  private createPostPreview(post: PostView): HTMLElement {
    const div = document.createElement('div');
    div.className = 'post-preview';

    const author = document.createElement('span');
    author.className = 'post-preview-author';
    author.textContent = `@${post.author.handle}: `;

    const text = document.createElement('span');
    text.className = 'post-preview-text';
    // Truncate long posts
    const truncated =
      post.record.text.length > 100 ? post.record.text.slice(0, 100) + '...' : post.record.text;
    text.textContent = truncated;

    div.appendChild(author);
    div.appendChild(text);

    return div;
  }

  /**
   * Update modal after accepting/dismissing a cluster
   */
  private updateAfterChange(): void {
    const remainingClusters = this.modalBody.querySelectorAll('.cluster-item');

    if (remainingClusters.length === 0) {
      // Update title
      this.modalTitle.textContent = 'Review Suggestions (0 clusters remaining)';

      // Show completion message
      const completeMessage = document.createElement('p');
      completeMessage.textContent = 'All suggestions have been reviewed!';
      completeMessage.style.textAlign = 'center';
      completeMessage.style.color = '#5f6368';
      this.modalBody.appendChild(completeMessage);
    } else {
      // Update title with new count
      const totalPosts = Array.from(remainingClusters).reduce((sum, el) => {
        const stats = el.querySelector('.cluster-stats')?.textContent ?? '';
        const match = stats.match(/(\d+) posts/);
        return sum + (match ? parseInt(match[1] ?? '0', 10) : 0);
      }, 0);
      this.modalTitle.textContent = `Review Suggestions (${totalPosts} posts in ${remainingClusters.length} clusters)`;
    }
  }

  /**
   * Attach event listeners for closing
   */
  private attachEventListeners(): void {
    // Close button
    this.closeButton.addEventListener('click', () => {
      this.hide();
    });

    // Backdrop click (click on modal background, not content)
    this.modal.addEventListener('click', (event) => {
      if (event.target === this.modal) {
        this.hide();
      }
    });
  }
}
