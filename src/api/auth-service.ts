// pattern: Imperative Shell
import type { BlueskySession, CreateSessionResponse, Result } from '../types';

const AUTH_STORAGE_KEY = 'starcounter-bluesky-session';
const AUTH_ENDPOINT = 'https://bsky.social';

type SessionChangeCallback = (session: BlueskySession | null) => void;

/**
 * Manages Bluesky authentication
 * Handles login, logout, session persistence, and state notifications
 */
export class AuthService {
  private session: BlueskySession | null = null;
  private changeCallbacks: SessionChangeCallback[] = [];

  constructor() {
    this.restoreSession();
  }

  /**
   * Get current session (null if not logged in)
   */
  getSession(): BlueskySession | null {
    return this.session;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.session !== null;
  }

  /**
   * Login with identifier (handle or email) and app password
   */
  async login(identifier: string, password: string): Promise<Result<BlueskySession>> {
    try {
      const response = await fetch(`${AUTH_ENDPOINT}/xrpc/com.atproto.server.createSession`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier, password }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { message?: string };
        return {
          ok: false,
          error: new Error(errorData.message || `Login failed: HTTP ${response.status}`),
        };
      }

      const data: CreateSessionResponse = await response.json();

      this.session = {
        accessJwt: data.accessJwt,
        refreshJwt: data.refreshJwt,
        did: data.did,
        handle: data.handle,
      };

      this.persistSession();
      this.notifyChange();

      return { ok: true, value: this.session };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Logout and clear session
   */
  logout(): void {
    this.session = null;
    localStorage.removeItem(AUTH_STORAGE_KEY);
    this.notifyChange();
  }

  /**
   * Register callback for session changes
   */
  onSessionChange(callback: SessionChangeCallback): void {
    this.changeCallbacks.push(callback);
  }

  /**
   * Restore session from localStorage
   */
  private restoreSession(): void {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<BlueskySession>;
        // Validate structure
        if (parsed.accessJwt && parsed.refreshJwt && parsed.did && parsed.handle) {
          this.session = parsed as BlueskySession;
        }
      }
    } catch {
      // Invalid stored session, ignore and clear
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }

  /**
   * Persist session to localStorage
   */
  private persistSession(): void {
    if (this.session) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(this.session));
    }
  }

  /**
   * Notify all callbacks of session change
   */
  private notifyChange(): void {
    for (const callback of this.changeCallbacks) {
      callback(this.session);
    }
  }
}
