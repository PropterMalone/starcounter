import type { PostView } from '../types';

/**
 * Callbacks for user refinement actions
 */
export type DrillDownCallbacks = {
  onExclude?: (category: string) => void;
  onAssign?: (postUri: string, category: string) => void;
  getCategories?: () => string[];
  onAddTag?: () => void;
};

/**
 * Drill-down modal for viewing contributing posts
 * Shows posts that contributed to a mention's count
 */

export class DrillDownModal {
  /** Element that was focused before modal opened, to restore on close */
  private previouslyFocusedElement: HTMLElement | null = null;

  /** Bound keyboard handler for cleanup */
  private boundKeydownHandler: (e: KeyboardEvent) => void;

  /** Callbacks for user refinement */
  private callbacks: DrillDownCallbacks = {};

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
   * Set callbacks for user refinement actions
   */
  setCallbacks(callbacks: DrillDownCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Show modal with mention and contributing posts
   */
  show(mention: string, posts: PostView[]): void {
    // Save currently focused element to restore later
    this.previouslyFocusedElement = document.activeElement as HTMLElement;

    this.modalTitle.textContent = `Contributing Posts for "${mention}"`;
    this.renderPosts(posts, mention);
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
   * Handle keyboard events (Escape to close)
   */
  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.hide();
    }
  }

  /**
   * Render post items in modal body
   */
  private renderPosts(posts: PostView[], category: string): void {
    // Clear existing content
    this.modalBody.innerHTML = '';

    const isUncategorized = category === '(Uncategorized)';

    // Add exclude button for non-uncategorized categories
    if (!isUncategorized && this.callbacks.onExclude) {
      const excludeContainer = document.createElement('div');
      excludeContainer.className = 'modal-actions';

      const excludeBtn = document.createElement('button');
      excludeBtn.className = 'btn btn-secondary btn-small';
      excludeBtn.textContent = 'Exclude from results';
      excludeBtn.addEventListener('click', () => {
        this.callbacks.onExclude?.(category);
        this.hide();
      });

      excludeContainer.appendChild(excludeBtn);
      this.modalBody.appendChild(excludeContainer);
    }

    // Add "Add Tag" button for uncategorized category
    if (isUncategorized && this.callbacks.onAddTag) {
      const addTagContainer = document.createElement('div');
      addTagContainer.className = 'modal-actions';

      const addTagBtn = document.createElement('button');
      addTagBtn.className = 'btn btn-primary btn-small';
      addTagBtn.textContent = '+ Add Tag';
      addTagBtn.addEventListener('click', () => {
        this.hide();
        this.callbacks.onAddTag?.();
      });

      addTagContainer.appendChild(addTagBtn);
      this.modalBody.appendChild(addTagContainer);
    }

    if (posts.length === 0) {
      const emptyMessage = document.createElement('p');
      emptyMessage.textContent = 'No contributing posts found';
      emptyMessage.style.textAlign = 'center';
      emptyMessage.style.color = '#5f6368';
      this.modalBody.appendChild(emptyMessage);
      return;
    }

    // Render each post
    for (const post of posts) {
      const postItem = this.createPostItem(post, isUncategorized);
      this.modalBody.appendChild(postItem);
    }
  }

  /**
   * Create HTML element for a post
   */
  private createPostItem(post: PostView, showAssignment: boolean = false): HTMLElement {
    const div = document.createElement('div');
    div.className = 'post-item';

    // Author name and handle
    const authorDiv = document.createElement('div');
    authorDiv.className = 'post-author';

    const displayName = post.author.displayName || post.author.handle;
    authorDiv.textContent = displayName;

    const handleSpan = document.createElement('span');
    handleSpan.className = 'post-author-handle';
    handleSpan.textContent = ` @${post.author.handle}`;
    authorDiv.appendChild(handleSpan);

    // Post text
    const textDiv = document.createElement('div');
    textDiv.className = 'post-text';
    textDiv.textContent = post.record.text;

    // Post footer with link and optional assignment
    const footerDiv = document.createElement('div');
    footerDiv.className = 'post-footer';

    // Link to post
    const link = document.createElement('a');
    link.className = 'post-link';
    link.href = this.convertAtUriToBskyUrl(post.uri, post.author.handle);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'View on Bluesky →';
    footerDiv.appendChild(link);

    // Assignment dropdown for uncategorized posts
    if (showAssignment && this.callbacks.onAssign && this.callbacks.getCategories) {
      const categories = this.callbacks.getCategories();
      if (categories.length > 0) {
        const assignContainer = document.createElement('div');
        assignContainer.className = 'post-assign';

        const label = document.createElement('label');
        label.textContent = 'Assign to: ';
        label.className = 'assign-label';

        const select = document.createElement('select');
        select.className = 'assign-select';

        // Default empty option
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '— Select category —';
        select.appendChild(defaultOpt);

        // Category options
        for (const cat of categories) {
          const opt = document.createElement('option');
          opt.value = cat;
          opt.textContent = cat;
          select.appendChild(opt);
        }

        select.addEventListener('change', () => {
          if (select.value) {
            this.callbacks.onAssign?.(post.uri, select.value);
            // Remove this post from the modal (it's been assigned)
            div.remove();

            // Check if modal is now empty
            const remainingPosts = this.modalBody.querySelectorAll('.post-item');
            if (remainingPosts.length === 0) {
              const emptyMessage = document.createElement('p');
              emptyMessage.textContent = 'All posts have been assigned';
              emptyMessage.style.textAlign = 'center';
              emptyMessage.style.color = '#5f6368';
              this.modalBody.appendChild(emptyMessage);
            }
          }
        });

        assignContainer.appendChild(label);
        assignContainer.appendChild(select);
        footerDiv.appendChild(assignContainer);
      }
    }

    // Assemble
    div.appendChild(authorDiv);
    div.appendChild(textDiv);
    div.appendChild(footerDiv);

    return div;
  }

  /**
   * Convert AT-URI to Bluesky web URL
   * at://did:plc:xxx/app.bsky.feed.post/yyy -> https://bsky.app/profile/handle/post/yyy
   */
  private convertAtUriToBskyUrl(atUri: string, handle: string): string {
    const parts = atUri.split('/');
    const postId = parts[parts.length - 1];
    return `https://bsky.app/profile/${handle}/post/${postId}`;
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
