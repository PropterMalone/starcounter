import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ClusterReviewModal } from './cluster-review';
import type { ClusterSuggestion } from '../lib/clustering';
import type { PostView } from '../types';

describe('ClusterReviewModal', () => {
  let dom: JSDOM;
  let document: Document;
  let modal: HTMLElement;
  let modalTitle: HTMLElement;
  let modalBody: HTMLElement;
  let closeButton: HTMLButtonElement;

  const createMockPost = (uri: string, text: string, handle = 'user'): PostView => ({
    uri,
    cid: 'cid-' + uri,
    author: {
      did: 'did:plc:' + handle,
      handle,
      displayName: handle,
    },
    record: {
      text,
      createdAt: new Date().toISOString(),
      $type: 'app.bsky.feed.post',
    },
    indexedAt: new Date().toISOString(),
    replyCount: 0,
    repostCount: 0,
    likeCount: 0,
    quoteCount: 0,
  });

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="cluster-review-modal" class="modal" style="display: none">
            <div class="modal-content">
              <div class="modal-header">
                <h2 id="cluster-modal-title">Review Suggestions</h2>
                <button class="modal-close" id="cluster-modal-close-button">×</button>
              </div>
              <div class="modal-body" id="cluster-modal-body"></div>
            </div>
          </div>
        </body>
      </html>
    `);

    document = dom.window.document;
    global.document = document as unknown as Document;

    modal = document.getElementById('cluster-review-modal') as HTMLElement;
    modalTitle = document.getElementById('cluster-modal-title') as HTMLElement;
    modalBody = document.getElementById('cluster-modal-body') as HTMLElement;
    closeButton = document.getElementById('cluster-modal-close-button') as HTMLButtonElement;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize without errors', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);
      expect(clusterModal).toBeDefined();
    });
  });

  describe('show', () => {
    it('should display the modal', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      const suggestions: ClusterSuggestion[] = [
        {
          suggestedCategory: 'The Matrix',
          postUris: ['post1', 'post2'],
          score: 0.8,
          method: 'fingerprint',
        },
      ];

      const postsByUri = new Map<string, PostView>([
        ['post1', createMockPost('post1', 'I love the matrix')],
        ['post2', createMockPost('post2', 'matrix is great')],
      ]);

      clusterModal.show({ suggestions, postsByUri });

      expect(modal.style.display).toBe('flex');
      expect(modalTitle.textContent).toContain('2 posts');
      expect(modalTitle.textContent).toContain('1 cluster');
    });

    it('should render cluster items', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      const suggestions: ClusterSuggestion[] = [
        {
          suggestedCategory: 'Pulp Fiction',
          postUris: ['post1'],
          score: 0.75,
          method: 'ngram',
        },
      ];

      const postsByUri = new Map<string, PostView>([
        ['post1', createMockPost('post1', 'pulp fiction is amazing')],
      ]);

      clusterModal.show({ suggestions, postsByUri });

      const clusterItem = modalBody.querySelector('.cluster-item');
      expect(clusterItem).not.toBeNull();

      const title = modalBody.querySelector('.cluster-title');
      expect(title?.textContent).toBe('Pulp Fiction');

      const stats = modalBody.querySelector('.cluster-stats');
      expect(stats?.textContent).toContain('1 posts');
      expect(stats?.textContent).toContain('75% confidence');
      expect(stats?.textContent).toContain('ngram');
    });

    it('should show empty message when no suggestions', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      clusterModal.show({ suggestions: [], postsByUri: new Map() });

      expect(modalBody.textContent).toContain('No suggestions available');
    });
  });

  describe('hide', () => {
    it('should hide the modal', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      clusterModal.show({ suggestions: [], postsByUri: new Map() });
      expect(modal.style.display).toBe('flex');

      clusterModal.hide();
      expect(modal.style.display).toBe('none');
    });

    it('should hide on close button click', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      clusterModal.show({ suggestions: [], postsByUri: new Map() });
      closeButton.click();

      expect(modal.style.display).toBe('none');
    });

    it('should hide on backdrop click', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      clusterModal.show({ suggestions: [], postsByUri: new Map() });

      // Create a click event targeting the modal backdrop
      const event = new dom.window.MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: modal });
      modal.dispatchEvent(event);

      expect(modal.style.display).toBe('none');
    });

    it('should hide on Escape key', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      clusterModal.show({ suggestions: [], postsByUri: new Map() });

      const event = new dom.window.KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);

      expect(modal.style.display).toBe('none');
    });

    it('should restore focus to previously focused element on hide', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      // Create a button that was previously focused
      const previousButton = document.createElement('button');
      previousButton.id = 'previous-button';
      document.body.appendChild(previousButton);

      // Spy on the focus method
      const focusSpy = vi.spyOn(previousButton, 'focus');

      // Simulate that this button is currently focused by making it document.activeElement
      // We need to actually focus it in jsdom
      previousButton.focus();

      clusterModal.show({ suggestions: [], postsByUri: new Map() });

      // Reset spy call count after show() focuses closeButton
      focusSpy.mockClear();

      clusterModal.hide();

      // Focus should be restored to the previous button
      expect(focusSpy).toHaveBeenCalled();

      // Cleanup
      document.body.removeChild(previousButton);
    });

    it('should handle hide when no previously focused element exists', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      // Mock document.activeElement to return null/body
      Object.defineProperty(document, 'activeElement', {
        value: null,
        configurable: true,
        writable: true,
      });

      // Show modal with no active element
      clusterModal.show({ suggestions: [], postsByUri: new Map() });

      // Hide should not throw error when previouslyFocusedElement is null
      expect(() => clusterModal.hide()).not.toThrow();
      expect(modal.style.display).toBe('none');
    });
  });

  describe('callbacks', () => {
    it('should call onAcceptCluster when accept button clicked', () => {
      const onAcceptCluster = vi.fn();
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);
      clusterModal.setCallbacks({ onAcceptCluster });

      const suggestions: ClusterSuggestion[] = [
        {
          suggestedCategory: 'The Matrix',
          postUris: ['post1', 'post2'],
          score: 0.9,
          method: 'fingerprint',
        },
      ];

      const postsByUri = new Map<string, PostView>([
        ['post1', createMockPost('post1', 'matrix text')],
        ['post2', createMockPost('post2', 'more matrix')],
      ]);

      clusterModal.show({ suggestions, postsByUri });

      const acceptBtn = modalBody.querySelector('.btn-primary') as HTMLButtonElement;
      acceptBtn.click();

      expect(onAcceptCluster).toHaveBeenCalledWith(['post1', 'post2'], 'The Matrix');
    });

    it('should call onDismissCluster when dismiss button clicked', () => {
      const onDismissCluster = vi.fn();
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);
      clusterModal.setCallbacks({ onDismissCluster });

      const suggestions: ClusterSuggestion[] = [
        {
          suggestedCategory: 'Inception',
          postUris: ['post1'],
          score: 0.6,
          method: 'ngram',
        },
      ];

      const postsByUri = new Map<string, PostView>([
        ['post1', createMockPost('post1', 'inception text')],
      ]);

      clusterModal.show({ suggestions, postsByUri });

      // Find the dismiss button (secondary button with "Dismiss" text)
      const buttons = modalBody.querySelectorAll('.btn-secondary');
      const dismissBtn = Array.from(buttons).find(
        (btn) => btn.textContent === 'Dismiss'
      ) as HTMLButtonElement;
      dismissBtn.click();

      expect(onDismissCluster).toHaveBeenCalledWith('Inception');
    });

    it('should remove cluster item after accept', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);
      clusterModal.setCallbacks({ onAcceptCluster: vi.fn() });

      const suggestions: ClusterSuggestion[] = [
        {
          suggestedCategory: 'Test',
          postUris: ['post1'],
          score: 0.8,
          method: 'fingerprint',
        },
      ];

      const postsByUri = new Map<string, PostView>([['post1', createMockPost('post1', 'test')]]);

      clusterModal.show({ suggestions, postsByUri });

      expect(modalBody.querySelectorAll('.cluster-item').length).toBe(1);

      const acceptBtn = modalBody.querySelector('.btn-primary') as HTMLButtonElement;
      acceptBtn.click();

      expect(modalBody.querySelectorAll('.cluster-item').length).toBe(0);
    });
  });

  describe('expand posts', () => {
    it('should toggle posts visibility when expand button clicked', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      const suggestions: ClusterSuggestion[] = [
        {
          suggestedCategory: 'Test Movie',
          postUris: ['post1'],
          score: 0.9,
          method: 'fingerprint',
        },
      ];

      const postsByUri = new Map<string, PostView>([
        ['post1', createMockPost('post1', 'test movie text')],
      ]);

      clusterModal.show({ suggestions, postsByUri });

      const postsContainer = modalBody.querySelector('.cluster-posts') as HTMLElement;
      expect(postsContainer.style.display).toBe('none');

      // Find expand button
      const buttons = modalBody.querySelectorAll('.btn-secondary');
      const expandBtn = Array.from(buttons).find(
        (btn) => btn.textContent === 'Show posts'
      ) as HTMLButtonElement;

      expandBtn.click();
      expect(postsContainer.style.display).toBe('block');
      expect(expandBtn.textContent).toBe('Hide posts');

      expandBtn.click();
      expect(postsContainer.style.display).toBe('none');
      expect(expandBtn.textContent).toBe('Show posts');
    });

    it('should render post previews', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      const suggestions: ClusterSuggestion[] = [
        {
          suggestedCategory: 'Test',
          postUris: ['post1'],
          score: 0.9,
          method: 'fingerprint',
        },
      ];

      const postsByUri = new Map<string, PostView>([
        ['post1', createMockPost('post1', 'This is a test post about movies', 'alice')],
      ]);

      clusterModal.show({ suggestions, postsByUri });

      const postPreview = modalBody.querySelector('.post-preview');
      expect(postPreview).not.toBeNull();

      const author = postPreview?.querySelector('.post-preview-author');
      expect(author?.textContent).toContain('@alice');

      const text = postPreview?.querySelector('.post-preview-text');
      expect(text?.textContent).toContain('This is a test post about movies');
    });

    it('should truncate long post text', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      const longText = 'A'.repeat(150); // Longer than 100 chars

      const suggestions: ClusterSuggestion[] = [
        {
          suggestedCategory: 'Test',
          postUris: ['post1'],
          score: 0.9,
          method: 'fingerprint',
        },
      ];

      const postsByUri = new Map<string, PostView>([['post1', createMockPost('post1', longText)]]);

      clusterModal.show({ suggestions, postsByUri });

      const text = modalBody.querySelector('.post-preview-text');
      expect(text?.textContent).toContain('...');
      expect(text?.textContent?.length).toBeLessThan(longText.length);
    });
  });

  describe('reset', () => {
    it('should clear dismissed clusters', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);
      clusterModal.setCallbacks({ onDismissCluster: vi.fn() });

      const suggestions: ClusterSuggestion[] = [
        {
          suggestedCategory: 'Test',
          postUris: ['post1'],
          score: 0.8,
          method: 'fingerprint',
        },
      ];

      const postsByUri = new Map<string, PostView>([['post1', createMockPost('post1', 'test')]]);

      // Show and dismiss
      clusterModal.show({ suggestions, postsByUri });
      const buttons = modalBody.querySelectorAll('.btn-secondary');
      const dismissBtn = Array.from(buttons).find(
        (btn) => btn.textContent === 'Dismiss'
      ) as HTMLButtonElement;
      dismissBtn.click();

      // After dismiss, cluster should not appear
      clusterModal.show({ suggestions, postsByUri });
      expect(modalBody.querySelectorAll('.cluster-item').length).toBe(0);

      // After reset, cluster should appear again
      clusterModal.reset();
      clusterModal.show({ suggestions, postsByUri });
      expect(modalBody.querySelectorAll('.cluster-item').length).toBe(1);
    });
  });

  describe('multiple clusters', () => {
    it('should render multiple clusters', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      const suggestions: ClusterSuggestion[] = [
        {
          suggestedCategory: 'The Matrix',
          postUris: ['post1', 'post2'],
          score: 0.9,
          method: 'fingerprint',
        },
        {
          suggestedCategory: 'Inception',
          postUris: ['post3'],
          score: 0.7,
          method: 'ngram',
        },
      ];

      const postsByUri = new Map<string, PostView>([
        ['post1', createMockPost('post1', 'matrix 1')],
        ['post2', createMockPost('post2', 'matrix 2')],
        ['post3', createMockPost('post3', 'inception')],
      ]);

      clusterModal.show({ suggestions, postsByUri });

      const clusterItems = modalBody.querySelectorAll('.cluster-item');
      expect(clusterItems.length).toBe(2);

      expect(modalTitle.textContent).toContain('3 posts');
      expect(modalTitle.textContent).toContain('2 clusters');
    });

    it('should update title after accepting a cluster', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);
      clusterModal.setCallbacks({ onAcceptCluster: vi.fn() });

      const suggestions: ClusterSuggestion[] = [
        {
          suggestedCategory: 'Movie A',
          postUris: ['post1', 'post2'],
          score: 0.9,
          method: 'fingerprint',
        },
        {
          suggestedCategory: 'Movie B',
          postUris: ['post3'],
          score: 0.8,
          method: 'fingerprint',
        },
      ];

      const postsByUri = new Map<string, PostView>([
        ['post1', createMockPost('post1', 'a1')],
        ['post2', createMockPost('post2', 'a2')],
        ['post3', createMockPost('post3', 'b1')],
      ]);

      clusterModal.show({ suggestions, postsByUri });

      // Accept first cluster
      const acceptBtn = modalBody.querySelector('.btn-primary') as HTMLButtonElement;
      acceptBtn.click();

      // Title should update to reflect remaining cluster
      expect(modalTitle.textContent).toContain('1 posts');
      expect(modalTitle.textContent).toContain('1 cluster');
    });
  });

  describe('edge cases', () => {
    it('should handle missing postUri in postsByUri map', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      const suggestions: ClusterSuggestion[] = [
        {
          suggestedCategory: 'Test Movie',
          postUris: ['post1', 'missing-post', 'post2'],
          score: 0.8,
          method: 'fingerprint',
        },
      ];

      const postsByUri = new Map<string, PostView>([
        ['post1', createMockPost('post1', 'first post')],
        ['post2', createMockPost('post2', 'second post')],
        // 'missing-post' is not in the map
      ]);

      clusterModal.show({ suggestions, postsByUri });

      // Should only render the 2 posts that exist in the map
      const postPreviews = modalBody.querySelectorAll('.post-preview');
      expect(postPreviews.length).toBe(2);
    });

    it('should not hide modal when clicking on modal content', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      clusterModal.show({ suggestions: [], postsByUri: new Map() });

      // Click on modal content (not backdrop)
      const modalContent = modal.querySelector('.modal-content') as HTMLElement;
      const event = new dom.window.MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: modalContent });
      modal.dispatchEvent(event);

      // Modal should still be visible
      expect(modal.style.display).toBe('flex');
    });

    it('should not hide modal on non-Escape key press', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      clusterModal.show({ suggestions: [], postsByUri: new Map() });

      // Press Enter key (not Escape)
      const event = new dom.window.KeyboardEvent('keydown', { key: 'Enter' });
      document.dispatchEvent(event);

      // Modal should still be visible
      expect(modal.style.display).toBe('flex');
    });

    it('should handle expand button click when posts container is missing', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);

      const suggestions: ClusterSuggestion[] = [
        {
          suggestedCategory: 'Test',
          postUris: ['post1'],
          score: 0.8,
          method: 'fingerprint',
        },
      ];

      const postsByUri = new Map<string, PostView>([['post1', createMockPost('post1', 'test')]]);

      clusterModal.show({ suggestions, postsByUri });

      // Remove the posts container from DOM to simulate broken structure
      const clusterItem = modalBody.querySelector('.cluster-item') as HTMLElement;
      const postsContainer = clusterItem.querySelector('.cluster-posts') as HTMLElement;
      postsContainer.remove();

      // Click expand button - should not throw error
      const buttons = modalBody.querySelectorAll('.btn-secondary');
      const expandBtn = Array.from(buttons).find(
        (btn) => btn.textContent === 'Show posts'
      ) as HTMLButtonElement;

      expect(() => expandBtn.click()).not.toThrow();
    });

    it('should handle malformed cluster stats text during update', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);
      clusterModal.setCallbacks({ onAcceptCluster: vi.fn() });

      const suggestions: ClusterSuggestion[] = [
        {
          suggestedCategory: 'Movie A',
          postUris: ['post1', 'post2'],
          score: 0.9,
          method: 'fingerprint',
        },
        {
          suggestedCategory: 'Movie B',
          postUris: ['post3'],
          score: 0.8,
          method: 'fingerprint',
        },
      ];

      const postsByUri = new Map<string, PostView>([
        ['post1', createMockPost('post1', 'a')],
        ['post2', createMockPost('post2', 'b')],
        ['post3', createMockPost('post3', 'c')],
      ]);

      clusterModal.show({ suggestions, postsByUri });

      // Manually corrupt the stats text of the second cluster to NOT match the pattern
      const clusterItems = modalBody.querySelectorAll('.cluster-item');
      const statsEl = clusterItems[1].querySelector('.cluster-stats') as HTMLElement;
      statsEl.textContent = 'invalid format - no posts number';

      // Accept first cluster - should trigger updateAfterChange with malformed stats
      const acceptBtn = modalBody.querySelector('.btn-primary') as HTMLButtonElement;
      acceptBtn.click();

      // Should still update title, treating malformed stats as 0 posts (only the malformed cluster remains)
      expect(modalTitle.textContent).toContain('0 posts');
      expect(modalTitle.textContent).toContain('1 cluster');
    });

    it('should handle null match result in stats regex', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);
      clusterModal.setCallbacks({ onAcceptCluster: vi.fn() });

      const suggestions: ClusterSuggestion[] = [
        {
          suggestedCategory: 'Test',
          postUris: ['post1'],
          score: 0.8,
          method: 'fingerprint',
        },
      ];

      const postsByUri = new Map<string, PostView>([['post1', createMockPost('post1', 'test')]]);

      clusterModal.show({ suggestions, postsByUri });

      // Corrupt the stats element to have no matching pattern
      const statsEl = modalBody.querySelector('.cluster-stats') as HTMLElement;
      statsEl.textContent = '';

      // Trigger an accept which calls updateAfterChange
      const acceptBtn = modalBody.querySelector('.btn-primary') as HTMLButtonElement;
      acceptBtn.click();

      // Should handle gracefully (empty cluster list now, so should show completion message)
      expect(modalTitle.textContent).toContain('0 clusters remaining');
    });

    it('should handle cluster with missing stats element', () => {
      const clusterModal = new ClusterReviewModal(modal, modalTitle, modalBody, closeButton);
      clusterModal.setCallbacks({ onAcceptCluster: vi.fn() });

      // Create a cluster that will be accepted
      const suggestions: ClusterSuggestion[] = [
        {
          suggestedCategory: 'Accept Me',
          postUris: ['post1'],
          score: 0.9,
          method: 'fingerprint',
        },
        {
          suggestedCategory: 'Keep Me',
          postUris: ['post2'],
          score: 0.8,
          method: 'fingerprint',
        },
      ];

      const postsByUri = new Map<string, PostView>([
        ['post1', createMockPost('post1', 'first')],
        ['post2', createMockPost('post2', 'second')],
      ]);

      clusterModal.show({ suggestions, postsByUri });

      // Remove stats element from remaining cluster to trigger the optional chaining fallback
      const clusters = modalBody.querySelectorAll('.cluster-item');
      const statsEl = clusters[1].querySelector('.cluster-stats') as HTMLElement;
      statsEl.remove();

      // Accept first cluster to trigger updateAfterChange
      const acceptBtn = modalBody.querySelector('.btn-primary') as HTMLButtonElement;
      acceptBtn.click();

      // Should handle the missing stats gracefully
      expect(modalTitle.textContent).toContain('0 posts');
      expect(modalTitle.textContent).toContain('1 cluster');
    });
  });
});
