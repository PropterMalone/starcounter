import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { InputForm } from './input-form';

describe('InputForm', () => {
  let dom: JSDOM;
  let document: Document;
  let form: HTMLFormElement;
  let input: HTMLInputElement;
  let submitButton: HTMLButtonElement;
  let cancelButton: HTMLButtonElement;
  let errorSpan: HTMLSpanElement;

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <form id="analyze-form">
            <input type="url" id="post-url" name="post-url" />
            <span class="error-message" id="url-error"></span>
            <button type="submit" id="analyze-button">Analyze</button>
            <button type="button" id="cancel-button">Cancel</button>
          </form>
        </body>
      </html>
    `);

    document = dom.window.document;
    global.document = document as unknown as Document;

    form = document.getElementById('analyze-form') as HTMLFormElement;
    input = document.getElementById('post-url') as HTMLInputElement;
    submitButton = document.getElementById('analyze-button') as HTMLButtonElement;
    cancelButton = document.getElementById('cancel-button') as HTMLButtonElement;
    errorSpan = document.getElementById('url-error') as HTMLSpanElement;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should attach to form elements', () => {
      const inputForm = new InputForm(
        form,
        input,
        submitButton,
        cancelButton,
        errorSpan
      );

      expect(inputForm).toBeDefined();
    });
  });

  describe('URL validation', () => {
    it('should validate correct Bluesky URLs', () => {
      const inputForm = new InputForm(form, input, submitButton, cancelButton, errorSpan);

      const validUrls = [
        'https://bsky.app/profile/alice.bsky.social/post/3k7qr5xya2c2a',
        'https://bsky.app/profile/bob.com/post/abc123',
      ];

      for (const url of validUrls) {
        expect(inputForm.validateUrl(url)).toBe(true);
      }
    });

    it('should reject invalid URLs', () => {
      const inputForm = new InputForm(form, input, submitButton, cancelButton, errorSpan);

      const invalidUrls = [
        'https://twitter.com/user/status/123',
        'https://bsky.app/profile/user',
        'not-a-url',
        '',
      ];

      for (const url of invalidUrls) {
        expect(inputForm.validateUrl(url)).toBe(false);
      }
    });

    it('should display error message for invalid URL', () => {
      const inputForm = new InputForm(form, input, submitButton, cancelButton, errorSpan);

      input.value = 'https://twitter.com/user/status/123';
      inputForm.validateUrl(input.value);

      const event = new dom.window.Event('submit');
      form.dispatchEvent(event);

      expect(errorSpan.textContent).toContain('valid Bluesky post URL');
    });
  });

  describe('form submission', () => {
    it('should call onSubmit callback with valid URL', () => {
      const onSubmit = vi.fn();
      const inputForm = new InputForm(form, input, submitButton, cancelButton, errorSpan);

      inputForm.onSubmit(onSubmit);

      input.value = 'https://bsky.app/profile/alice.bsky.social/post/3k7qr5xya2c2a';

      const event = new dom.window.Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(event);

      expect(onSubmit).toHaveBeenCalledWith(
        'https://bsky.app/profile/alice.bsky.social/post/3k7qr5xya2c2a'
      );
    });

    it('should prevent submission with invalid URL', () => {
      const onSubmit = vi.fn();
      const inputForm = new InputForm(form, input, submitButton, cancelButton, errorSpan);

      inputForm.onSubmit(onSubmit);

      input.value = 'invalid-url';

      const event = new dom.window.Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(event);

      expect(onSubmit).not.toHaveBeenCalled();
      expect(errorSpan.textContent).toBeTruthy();
    });

    it('should disable form during analysis', () => {
      const inputForm = new InputForm(form, input, submitButton, cancelButton, errorSpan);

      inputForm.setAnalyzing(true);

      expect(input.disabled).toBe(true);
      expect(submitButton.disabled).toBe(true);
    });

    it('should show cancel button during analysis', () => {
      const inputForm = new InputForm(form, input, submitButton, cancelButton, errorSpan);

      inputForm.setAnalyzing(true);

      expect(cancelButton.style.display).not.toBe('none');
    });
  });

  describe('cancel functionality', () => {
    it('should call onCancel callback when cancel clicked', () => {
      const onCancel = vi.fn();
      const inputForm = new InputForm(form, input, submitButton, cancelButton, errorSpan);

      inputForm.onCancel(onCancel);
      inputForm.setAnalyzing(true);

      const event = new dom.window.Event('click');
      cancelButton.dispatchEvent(event);

      expect(onCancel).toHaveBeenCalled();
    });

    it('should re-enable form after cancel', () => {
      const inputForm = new InputForm(form, input, submitButton, cancelButton, errorSpan);

      inputForm.setAnalyzing(true);
      inputForm.setAnalyzing(false);

      expect(input.disabled).toBe(false);
      expect(submitButton.disabled).toBe(false);
      expect(cancelButton.style.display).toBe('none');
    });
  });

  describe('reset', () => {
    it('should clear input and error message', () => {
      const inputForm = new InputForm(form, input, submitButton, cancelButton, errorSpan);

      input.value = 'https://bsky.app/profile/user/post/123';
      errorSpan.textContent = 'Some error';

      inputForm.reset();

      expect(input.value).toBe('');
      expect(errorSpan.textContent).toBe('');
    });
  });

  describe('error handling', () => {
    it('should show error message', () => {
      const inputForm = new InputForm(form, input, submitButton, cancelButton, errorSpan);

      inputForm.showError('Test error message');

      expect(errorSpan.textContent).toBe('Test error message');
    });

    it('should clear error on input change', () => {
      const inputForm = new InputForm(form, input, submitButton, cancelButton, errorSpan);

      inputForm.showError('Test error');
      expect(errorSpan.textContent).toBe('Test error');

      const event = new dom.window.Event('input');
      input.dispatchEvent(event);

      expect(errorSpan.textContent).toBe('');
    });
  });
});
