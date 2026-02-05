// pattern: Imperative Shell
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdvancedToggle } from './advanced-toggle';

describe('AdvancedToggle', () => {
  let container: HTMLDivElement;
  let checkbox: HTMLInputElement;
  let label: HTMLLabelElement;
  let statusSpan: HTMLSpanElement;
  let toggle: AdvancedToggle;

  beforeEach(() => {
    // Set up DOM elements
    container = document.createElement('div');
    checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'advanced-mode';
    label = document.createElement('label');
    label.htmlFor = 'advanced-mode';
    statusSpan = document.createElement('span');
    statusSpan.id = 'advanced-status';

    container.appendChild(checkbox);
    container.appendChild(label);
    container.appendChild(statusSpan);
    document.body.appendChild(container);

    // Clear localStorage before each test
    localStorage.clear();

    toggle = new AdvancedToggle(checkbox, statusSpan);
  });

  afterEach(() => {
    document.body.removeChild(container);
    localStorage.clear();
  });

  describe('initial state', () => {
    it('should be disabled by default', () => {
      expect(toggle.isEnabled()).toBe(false);
      expect(checkbox.checked).toBe(false);
    });

    it('should restore state from localStorage', () => {
      localStorage.setItem('starcounter-advanced-mode', 'true');
      const toggle2 = new AdvancedToggle(checkbox, statusSpan);

      expect(toggle2.isEnabled()).toBe(true);
      expect(checkbox.checked).toBe(true);
    });

    it('should handle invalid localStorage value', () => {
      localStorage.setItem('starcounter-advanced-mode', 'invalid');
      const toggle2 = new AdvancedToggle(checkbox, statusSpan);

      expect(toggle2.isEnabled()).toBe(false);
    });
  });

  describe('toggle behavior', () => {
    it('should enable when checkbox is checked', () => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(toggle.isEnabled()).toBe(true);
    });

    it('should disable when checkbox is unchecked', () => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));

      expect(toggle.isEnabled()).toBe(false);
    });

    it('should persist state to localStorage', () => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(localStorage.getItem('starcounter-advanced-mode')).toBe('true');

      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));

      expect(localStorage.getItem('starcounter-advanced-mode')).toBe('false');
    });
  });

  describe('onChange callback', () => {
    it('should call callback when state changes', () => {
      const callback = vi.fn();
      toggle.onChange(callback);

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(callback).toHaveBeenCalledWith(true);
    });

    it('should call callback with false when disabled', () => {
      const callback = vi.fn();
      toggle.onChange(callback);

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));

      expect(callback).toHaveBeenLastCalledWith(false);
    });
  });

  describe('setLoading', () => {
    it('should disable checkbox when loading', () => {
      toggle.setLoading(true);

      expect(checkbox.disabled).toBe(true);
    });

    it('should enable checkbox when not loading', () => {
      toggle.setLoading(true);
      toggle.setLoading(false);

      expect(checkbox.disabled).toBe(false);
    });

    it('should show loading status', () => {
      toggle.setLoading(true);

      expect(statusSpan.textContent).toContain('Loading');
    });
  });

  describe('setProgress', () => {
    it('should show download progress', () => {
      toggle.setProgress(0.5);

      expect(statusSpan.textContent).toContain('50%');
    });

    it('should round progress percentage', () => {
      toggle.setProgress(0.333);

      expect(statusSpan.textContent).toContain('33%');
    });
  });

  describe('setReady', () => {
    it('should show ready status', () => {
      toggle.setReady(true);

      expect(statusSpan.textContent).toContain('Ready');
    });

    it('should clear status when not ready', () => {
      toggle.setReady(true);
      toggle.setReady(false);

      expect(statusSpan.textContent).toBe('');
    });
  });

  describe('setError', () => {
    it('should show error message', () => {
      toggle.setError('Failed to load model');

      expect(statusSpan.textContent).toContain('Failed to load model');
    });

    it('should add error class', () => {
      toggle.setError('Error');

      expect(statusSpan.classList.contains('error')).toBe(true);
    });
  });

  describe('enable/disable programmatically', () => {
    it('should enable programmatically', () => {
      toggle.setEnabled(true);

      expect(toggle.isEnabled()).toBe(true);
      expect(checkbox.checked).toBe(true);
    });

    it('should disable programmatically', () => {
      toggle.setEnabled(true);
      toggle.setEnabled(false);

      expect(toggle.isEnabled()).toBe(false);
      expect(checkbox.checked).toBe(false);
    });

    it('should trigger onChange callback when set programmatically', () => {
      const callback = vi.fn();
      toggle.onChange(callback);

      toggle.setEnabled(true);

      expect(callback).toHaveBeenCalledWith(true);
    });

    it('should persist programmatic changes to localStorage', () => {
      toggle.setEnabled(true);

      expect(localStorage.getItem('starcounter-advanced-mode')).toBe('true');
    });
  });
});
