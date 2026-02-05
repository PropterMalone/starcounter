// pattern: Imperative Shell tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShareButton } from './share-button';
import type { MentionCount } from '../types';
import { decodeResults } from '../lib/url-encoder';

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

    shareButton = new ShareButton(button, feedback, feedbackText);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('setResults', () => {
    it('should store results for sharing', () => {
      const results: MentionCount[] = [
        { mention: 'The Matrix', count: 5, posts: [] },
        { mention: 'Inception', count: 3, posts: [] },
      ];

      shareButton.setResults(results);

      // Should not throw, results stored internally
      expect(() => shareButton.setResults(results)).not.toThrow();
    });
  });

  describe('share button click', () => {
    it('should copy URL to clipboard when clicked', async () => {
      const results: MentionCount[] = [{ mention: 'Test Movie', count: 10, posts: [] }];
      shareButton.setResults(results);

      // Click the share button
      button.click();

      // Wait for async clipboard operation
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    });

    it('should generate URL with encoded results', async () => {
      const results: MentionCount[] = [
        { mention: 'The Matrix', count: 5, posts: [] },
        { mention: 'Inception', count: 3, posts: [] },
      ];
      shareButton.setResults(results);

      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const clipboardCall = vi.mocked(navigator.clipboard.writeText).mock.calls[0];
      const copiedUrl = clipboardCall[0];

      // URL should contain r parameter
      expect(copiedUrl).toContain('?r=');

      // Extract and decode the results
      const url = new URL(copiedUrl);
      const encoded = url.searchParams.get('r');
      expect(encoded).not.toBeNull();

      const decoded = decodeResults(encoded!);
      expect(decoded).not.toBeNull();
      expect(decoded!.m).toHaveLength(2);
      expect(decoded!.m[0].n).toBe('The Matrix');
      expect(decoded!.m[0].c).toBe(5);
    });

    it('should show feedback after copying', async () => {
      const results: MentionCount[] = [{ mention: 'Movie', count: 1, posts: [] }];
      shareButton.setResults(results);

      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(feedback.style.display).toBe('block');
      expect(feedbackText.textContent).toContain('copied');
    });

    it('should auto-hide feedback after delay', async () => {
      vi.useFakeTimers();

      const results: MentionCount[] = [{ mention: 'Movie', count: 1, posts: [] }];
      shareButton.setResults(results);

      button.click();
      await vi.runAllTimersAsync();

      // Wait for the hide delay (3 seconds)
      vi.advanceTimersByTime(3000);

      expect(feedback.style.display).toBe('none');

      vi.useRealTimers();
    });

    it('should not share if no results set', async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });
  });

  describe('clipboard error handling', () => {
    it('should show error feedback when clipboard fails', async () => {
      vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('Clipboard error'));

      const results: MentionCount[] = [{ mention: 'Movie', count: 1, posts: [] }];
      shareButton.setResults(results);

      // Spy on console.error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      button.click();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(feedbackText.textContent).toContain('Failed');

      consoleSpy.mockRestore();
    });
  });

  describe('URL generation', () => {
    it('should use current window location as base URL', async () => {
      // Set up window location
      Object.defineProperty(window, 'location', {
        value: {
          origin: 'https://starcounter.app',
          pathname: '/',
        },
        writable: true,
      });

      const results: MentionCount[] = [{ mention: 'Test', count: 1, posts: [] }];
      shareButton.setResults(results);

      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const copiedUrl = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
      expect(copiedUrl).toMatch(/^https:\/\/starcounter\.app\/?\?r=/);
    });
  });
});
