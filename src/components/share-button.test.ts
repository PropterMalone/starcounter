// pattern: Imperative Shell tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShareButton } from './share-button';
import type { ShareState } from './share-button';

function makeState(overrides: Partial<ShareState> = {}): ShareState {
  return {
    mentionCounts: [{ mention: 'Test Movie', count: 10, posts: [] }],
    uncategorizedPosts: [],
    excludedCategories: [],
    manualAssignments: {},
    originalPost: null,
    postCount: 100,
    ...overrides,
  };
}

describe('ShareButton', () => {
  let button: HTMLButtonElement;
  let feedback: HTMLElement;
  let feedbackText: HTMLElement;
  let shareButton: ShareButton;

  beforeEach(() => {
    // Create DOM elements
    button = document.createElement('button');
    button.id = 'share-button';

    feedback = document.createElement('div');
    feedback.id = 'share-feedback';
    feedback.style.display = 'none';

    feedbackText = document.createElement('span');
    feedbackText.id = 'share-feedback-text';
    feedback.appendChild(feedbackText);

    document.body.appendChild(button);
    document.body.appendChild(feedback);

    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    // Mock fetch for /api/share
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'abc12345' }),
      })
    );

    shareButton = new ShareButton(button, feedback, feedbackText);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('setStateProvider', () => {
    it('should accept a state provider function', () => {
      expect(() => shareButton.setStateProvider(() => makeState())).not.toThrow();
    });
  });

  describe('share button click', () => {
    it('should POST to /api/share and copy URL to clipboard', async () => {
      shareButton.setStateProvider(() => makeState());

      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should have called fetch with POST to /api/share
      expect(fetch).toHaveBeenCalledWith('/api/share', expect.objectContaining({ method: 'POST' }));

      // Should have copied a URL with ?s= parameter
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      const copiedUrl = vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0]!;
      expect(copiedUrl).toContain('?s=abc12345');
    });

    it('should serialize mentionCounts with stored posts', async () => {
      const state = makeState({
        mentionCounts: [
          {
            mention: 'The Nile',
            count: 5,
            posts: [
              {
                uri: 'at://did:plc:abc/app.bsky.feed.post/xyz',
                cid: 'cid123',
                author: { did: 'did:plc:abc', handle: 'alice.bsky.social', displayName: 'Alice' },
                record: { text: 'Nile!', createdAt: '2026-01-01T00:00:00Z' },
                indexedAt: '2026-01-01T00:00:00Z',
              },
            ],
          },
        ],
      });
      shareButton.setStateProvider(() => state);

      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const fetchCall = vi.mocked(fetch).mock.calls[0]!;
      const body = JSON.parse(fetchCall[1]?.body as string);

      expect(body.mentionCounts[0].mention).toBe('The Nile');
      expect(body.mentionCounts[0].count).toBe(5);
      // Post should be in compact StoredPost format
      expect(body.mentionCounts[0].posts[0].u).toBe('at://did:plc:abc/app.bsky.feed.post/xyz');
      expect(body.mentionCounts[0].posts[0].h).toBe('alice.bsky.social');
      expect(body.mentionCounts[0].posts[0].t).toBe('Nile!');
    });

    it('should include user tweaks in shared data', async () => {
      const state = makeState({
        excludedCategories: ['Category A'],
        manualAssignments: { 'at://post1': 'Category B' },
      });
      shareButton.setStateProvider(() => state);

      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const fetchCall = vi.mocked(fetch).mock.calls[0]!;
      const body = JSON.parse(fetchCall[1]?.body as string);

      expect(body.excludedCategories).toEqual(['Category A']);
      expect(body.manualAssignments).toEqual({ 'at://post1': 'Category B' });
    });

    it('should show feedback after copying', async () => {
      shareButton.setStateProvider(() => makeState());

      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(feedback.style.display).toBe('block');
      expect(feedbackText.textContent).toContain('copied');
    });

    it('should auto-hide feedback after delay', async () => {
      vi.useFakeTimers();

      shareButton.setStateProvider(() => makeState());

      button.click();
      await vi.runAllTimersAsync();

      // Wait for the hide delay (3 seconds)
      vi.advanceTimersByTime(3000);

      expect(feedback.style.display).toBe('none');

      vi.useRealTimers();
    });

    it('should not share if no state provider set', async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetch).not.toHaveBeenCalled();
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });

    it('should not share if mentionCounts is empty', async () => {
      shareButton.setStateProvider(() => makeState({ mentionCounts: [] }));

      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetch).not.toHaveBeenCalled();
    });

    it('should disable button during upload', async () => {
      // Use a slow-resolving fetch
      let resolvePost!: (value: unknown) => void;
      vi.mocked(fetch).mockReturnValue(
        new Promise((resolve) => {
          resolvePost = resolve;
        }) as Promise<Response>
      );

      shareButton.setStateProvider(() => makeState());

      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(button.disabled).toBe(true);

      // Resolve the fetch
      resolvePost({ ok: true, json: () => Promise.resolve({ id: 'xyz' }) });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(button.disabled).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should show error feedback when upload fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      shareButton.setStateProvider(() => makeState());

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      button.click();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(feedbackText.textContent).toContain('Failed');

      consoleSpy.mockRestore();
    });

    it('should show error feedback when clipboard fails', async () => {
      vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('Clipboard error'));

      shareButton.setStateProvider(() => makeState());

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      button.click();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(feedbackText.textContent).toContain('Failed');

      consoleSpy.mockRestore();
    });
  });

  describe('URL generation', () => {
    it('should use current window location as base URL', async () => {
      Object.defineProperty(window, 'location', {
        value: {
          origin: 'https://starcounter.app',
          pathname: '/',
        },
        writable: true,
      });

      shareButton.setStateProvider(() => makeState());

      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const copiedUrl = vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0]!;
      expect(copiedUrl).toMatch(/^https:\/\/starcounter\.app\/?\?s=abc12345$/);
    });
  });
});
