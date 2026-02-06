/**
 * Input form handler for Bluesky post URL analysis
 * Manages form state, validation, and user interactions
 */

export class InputForm {
  private submitCallback: ((url: string) => void) | null = null;
  private cancelCallback: (() => void) | null = null;

  constructor(
    private form: HTMLFormElement,
    private input: HTMLInputElement,
    private submitButton: HTMLButtonElement,
    private cancelButton: HTMLButtonElement,
    private errorSpan: HTMLSpanElement
  ) {
    this.attachEventListeners();
  }

  /**
   * Register callback for form submission
   */
  onSubmit(callback: (url: string) => void): void {
    this.submitCallback = callback;
  }

  /**
   * Register callback for cancel action
   */
  onCancel(callback: () => void): void {
    this.cancelCallback = callback;
  }

  /**
   * Validate Bluesky post URL
   * Format: https://bsky.app/profile/{handle}/post/{postId}
   */
  validateUrl(url: string): boolean {
    if (!url) {
      return false;
    }

    const pattern = /^https:\/\/bsky\.app\/profile\/[^/]+\/post\/[a-zA-Z0-9]+$/;
    return pattern.test(url);
  }

  /**
   * Set analyzing state (disables form, shows cancel button)
   */
  setAnalyzing(analyzing: boolean): void {
    this.input.disabled = analyzing;
    this.submitButton.disabled = analyzing;

    if (analyzing) {
      this.cancelButton.style.display = 'inline-block';
    } else {
      this.cancelButton.style.display = 'none';
    }
  }

  /**
   * Reset form to initial state
   */
  reset(): void {
    this.input.value = '';
    this.errorSpan.textContent = '';
    this.setAnalyzing(false);
  }

  /**
   * Display error message
   */
  showError(message: string): void {
    this.errorSpan.textContent = message;
  }

  /**
   * Clear error message
   */
  clearError(): void {
    this.errorSpan.textContent = '';
  }

  /**
   * Attach event listeners to form elements
   */
  private attachEventListeners(): void {
    // Handle form submission
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();

      const url = this.input.value.trim();

      if (!this.validateUrl(url)) {
        this.showError('Please enter a valid Bluesky post URL');
        return;
      }

      this.clearError();

      if (this.submitCallback) {
        this.submitCallback(url);
      }
    });

    // Handle cancel button
    this.cancelButton.addEventListener('click', () => {
      if (this.cancelCallback) {
        this.cancelCallback();
      }
    });

    // Clear error on input change
    this.input.addEventListener('input', () => {
      this.clearError();
    });
  }
}
