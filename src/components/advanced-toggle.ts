// pattern: Imperative Shell

const STORAGE_KEY = 'starcounter-advanced-mode';

type ChangeCallback = (enabled: boolean) => void;

/**
 * Advanced sentiment analysis toggle component.
 * Manages the checkbox state for switching between basic and advanced sentiment.
 * Persists preference in localStorage.
 */
export class AdvancedToggle {
  private enabled = false;
  private changeCallbacks: Array<ChangeCallback> = [];

  constructor(
    private checkbox: HTMLInputElement,
    private statusSpan: HTMLSpanElement
  ) {
    this.restoreState();
    this.attachEventListeners();
  }

  /**
   * Check if advanced mode is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable or disable advanced mode programmatically.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.checkbox.checked = enabled;
    this.persistState();
    this.notifyChange();
  }

  /**
   * Register callback for state changes.
   */
  onChange(callback: ChangeCallback): void {
    this.changeCallbacks.push(callback);
  }

  /**
   * Show loading state (model downloading).
   */
  setLoading(loading: boolean): void {
    this.checkbox.disabled = loading;
    if (loading) {
      this.statusSpan.textContent = 'Loading model...';
      this.statusSpan.classList.remove('error', 'ready');
    } else {
      this.statusSpan.textContent = '';
    }
  }

  /**
   * Show download progress.
   */
  setProgress(progress: number): void {
    const percentage = Math.round(progress * 100);
    this.statusSpan.textContent = `Downloading: ${percentage}%`;
    this.statusSpan.classList.remove('error', 'ready');
  }

  /**
   * Show ready state (model loaded).
   */
  setReady(ready: boolean): void {
    if (ready) {
      this.statusSpan.textContent = 'Ready';
      this.statusSpan.classList.add('ready');
      this.statusSpan.classList.remove('error');
    } else {
      this.statusSpan.textContent = '';
      this.statusSpan.classList.remove('ready');
    }
  }

  /**
   * Show error message.
   */
  setError(message: string): void {
    this.statusSpan.textContent = message;
    this.statusSpan.classList.add('error');
    this.statusSpan.classList.remove('ready');
  }

  /**
   * Restore state from localStorage.
   */
  private restoreState(): void {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'true') {
      this.enabled = true;
      this.checkbox.checked = true;
    }
  }

  /**
   * Persist state to localStorage.
   */
  private persistState(): void {
    localStorage.setItem(STORAGE_KEY, String(this.enabled));
  }

  /**
   * Notify all change callbacks.
   */
  private notifyChange(): void {
    for (const callback of this.changeCallbacks) {
      callback(this.enabled);
    }
  }

  /**
   * Attach event listener to checkbox.
   */
  private attachEventListeners(): void {
    this.checkbox.addEventListener('change', () => {
      this.enabled = this.checkbox.checked;
      this.persistState();
      this.notifyChange();
    });
  }
}
