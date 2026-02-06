import type { PostView } from '../types';

/**
 * Drill-down modal for viewing contributing posts
 * Shows posts that contributed to a mention's count
 */

export class DrillDownModal {
  /** Element that was focused before modal opened, to restore on close */
  private previouslyFocusedElement: HTMLElement | null = null;

  /** Bound keyboard handler for cleanup */
  private boundKeydownHandler: (e: KeyboardEvent) => void;

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
   * Show modal with mention and contributing posts
   */
  show(mention: string, posts: PostView[]): void {
    // Save currently focused element to restore later
    this.previouslyFocusedElement = document.activeElement as HTMLElement;

    this.modalTitle.textContent = `Contributing Posts for "${mention}"`;
    this.renderPosts(posts);
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
  private renderPosts(posts: PostView[]): void {
    // Clear existing content
    this.modalBody.innerHTML = '';

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
      const postItem = this.createPostItem(post);
      this.modalBody.appendChild(postItem);
    }
  }

  /**
   * Create HTML element for a post
   */
  private createPostItem(post: PostView): HTMLElement {
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

    // Link to post
    const link = document.createElement('a');
    link.className = 'post-link';
    link.href = this.convertAtUriToBskyUrl(post.uri, post.author.handle);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'View on Bluesky →';

    // Assemble
    div.appendChild(authorDiv);
    div.appendChild(textDiv);
    div.appendChild(link);

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
