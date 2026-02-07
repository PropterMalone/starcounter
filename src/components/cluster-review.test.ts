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
});
