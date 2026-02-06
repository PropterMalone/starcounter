// pattern: Imperative Shell
import type { AuthService } from '../api/auth-service';

type LoginCallback = (success: boolean) => void;

/**
 * Login form component for optional Bluesky authentication
 * Follows same patterns as AdvancedToggle and InputForm
 */
export class LoginForm {
  private loginCallbacks: LoginCallback[] = [];
  private isExpanded = false;

  // DOM elements (created dynamically)
  private toggleButton: HTMLButtonElement | null = null;
  private formContainer: HTMLElement | null = null;
  private identifierInput: HTMLInputElement | null = null;
  private passwordInput: HTMLInputElement | null = null;
  private submitButton: HTMLButtonElement | null = null;
  private cancelButton: HTMLButtonElement | null = null;
  private logoutButton: HTMLButtonElement | null = null;
  private statusSpan: HTMLSpanElement | null = null;
  private errorDiv: HTMLDivElement | null = null;

  constructor(
    private container: HTMLElement,
    private authService: AuthService
  ) {
    this.render();
    this.cacheElements();
    this.attachEventListeners();
    this.updateDisplay();

    // Listen for external session changes
    this.authService.onSessionChange(() => {
      this.updateDisplay();
    });
  }

  /**
   * Register callback for login attempts
   */
  onLogin(callback: LoginCallback): void {
    this.loginCallbacks.push(callback);
  }

  /**
   * Render the login form HTML
   */
  private render(): void {
    this.container.innerHTML = `
      <div class="login-section">
        <button type="button" class="login-toggle" id="login-toggle">
          <span class="login-status" id="login-status">Not logged in (optional)</span>
          <span class="login-toggle-icon">&#9662;</span>
        </button>
        <div class="login-form-container" id="login-form-container" style="display: none;">
          <p class="login-hint">
            Optional: Log in to view restricted posts.
            <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noopener">Create an app password</a>
          </p>
          <div class="form-group">
            <label for="login-identifier">Handle or Email</label>
            <input type="text" id="login-identifier" placeholder="alice.bsky.social" autocomplete="username" />
          </div>
          <div class="form-group">
            <label for="login-password">App Password</label>
            <input type="password" id="login-password" placeholder="xxxx-xxxx-xxxx-xxxx" autocomplete="current-password" />
          </div>
          <div class="login-error" id="login-error" style="display: none;"></div>
          <div class="login-actions">
            <button type="button" class="btn btn-primary btn-small" id="login-submit">Log In</button>
            <button type="button" class="btn btn-secondary btn-small" id="login-cancel">Cancel</button>
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-small" id="logout-button" style="display: none;">
          Log Out
        </button>
      </div>
    `;
  }

  /**
   * Cache DOM element references
   */
  private cacheElements(): void {
    this.toggleButton = this.container.querySelector('#login-toggle');
    this.formContainer = this.container.querySelector('#login-form-container');
    this.identifierInput = this.container.querySelector('#login-identifier');
    this.passwordInput = this.container.querySelector('#login-password');
    this.submitButton = this.container.querySelector('#login-submit');
    this.cancelButton = this.container.querySelector('#login-cancel');
    this.logoutButton = this.container.querySelector('#logout-button');
    this.statusSpan = this.container.querySelector('#login-status');
    this.errorDiv = this.container.querySelector('#login-error');
  }

  /**
   * Update display based on authentication state
   */
  private updateDisplay(): void {
    const session = this.authService.getSession();

    if (session) {
      if (this.statusSpan) {
        this.statusSpan.textContent = `Logged in as @${session.handle}`;
        this.statusSpan.classList.add('logged-in');
      }
      if (this.logoutButton) {
        this.logoutButton.style.display = 'inline-block';
      }
      if (this.toggleButton) {
        this.toggleButton.style.display = 'none';
      }
      if (this.formContainer) {
        this.formContainer.style.display = 'none';
      }
      this.isExpanded = false;
    } else {
      if (this.statusSpan) {
        this.statusSpan.textContent = 'Not logged in (optional)';
        this.statusSpan.classList.remove('logged-in');
      }
      if (this.logoutButton) {
        this.logoutButton.style.display = 'none';
      }
      if (this.toggleButton) {
        this.toggleButton.style.display = 'flex';
      }
    }
  }

  /**
   * Attach event listeners
   */
  private attachEventListeners(): void {
    // Toggle form visibility
    this.toggleButton?.addEventListener('click', () => {
      this.isExpanded = !this.isExpanded;
      if (this.formContainer) {
        this.formContainer.style.display = this.isExpanded ? 'block' : 'none';
      }
    });

    // Cancel
    this.cancelButton?.addEventListener('click', () => {
      this.hideForm();
    });

    // Submit login
    this.submitButton?.addEventListener('click', () => {
      void this.handleLogin();
    });

    // Enter key in password field submits
    this.passwordInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        void this.handleLogin();
      }
    });

    // Logout
    this.logoutButton?.addEventListener('click', () => {
      this.authService.logout();
      this.updateDisplay();
    });
  }

  /**
   * Handle login form submission
   */
  private async handleLogin(): Promise<void> {
    const identifier = this.identifierInput?.value.trim() ?? '';
    const password = this.passwordInput?.value ?? '';

    if (!identifier || !password) {
      this.showError('Please enter both handle and app password');
      return;
    }

    this.setLoading(true);
    this.hideError();

    const result = await this.authService.login(identifier, password);

    this.setLoading(false);

    if (result.ok) {
      this.hideForm();
      this.clearInputs();
      this.updateDisplay();
      this.notifyLogin(true);
    } else {
      this.showError(result.error.message);
      this.notifyLogin(false);
    }
  }

  /**
   * Set loading state
   */
  private setLoading(loading: boolean): void {
    if (this.submitButton) {
      this.submitButton.disabled = loading;
      this.submitButton.textContent = loading ? 'Logging in...' : 'Log In';
    }
    if (this.cancelButton) {
      this.cancelButton.disabled = loading;
    }
  }

  /**
   * Show error message
   */
  private showError(message: string): void {
    if (this.errorDiv) {
      this.errorDiv.textContent = message;
      this.errorDiv.style.display = 'block';
    }
  }

  /**
   * Hide error message
   */
  private hideError(): void {
    if (this.errorDiv) {
      this.errorDiv.style.display = 'none';
    }
  }

  /**
   * Hide the form
   */
  private hideForm(): void {
    this.isExpanded = false;
    if (this.formContainer) {
      this.formContainer.style.display = 'none';
    }
    this.hideError();
  }

  /**
   * Clear input fields
   */
  private clearInputs(): void {
    if (this.identifierInput) {
      this.identifierInput.value = '';
    }
    if (this.passwordInput) {
      this.passwordInput.value = '';
    }
  }

  /**
   * Notify login callbacks
   */
  private notifyLogin(success: boolean): void {
    for (const callback of this.loginCallbacks) {
      callback(success);
    }
  }
}
