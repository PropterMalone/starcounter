import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthService } from './auth-service';

describe('AuthService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let localStorageMock: { [key: string]: string };

  beforeEach(() => {
    // Mock localStorage
    localStorageMock = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => localStorageMock[key] ?? null,
      setItem: (key: string, value: string) => {
        localStorageMock[key] = value;
      },
      removeItem: (key: string) => {
        delete localStorageMock[key];
      },
    });

    // Mock fetch
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should not be authenticated by default', () => {
      const service = new AuthService();
      expect(service.isAuthenticated()).toBe(false);
      expect(service.getSession()).toBeNull();
    });

    it('should restore session from localStorage', () => {
      const session = {
        accessJwt: 'access-token',
        refreshJwt: 'refresh-token',
        did: 'did:plc:test',
        handle: 'test.bsky.social',
      };
      localStorageMock['starcounter-bluesky-session'] = JSON.stringify(session);

      const service = new AuthService();
      expect(service.isAuthenticated()).toBe(true);
      expect(service.getSession()?.handle).toBe('test.bsky.social');
    });

    it('should ignore invalid stored session', () => {
      localStorageMock['starcounter-bluesky-session'] = 'invalid-json';

      const service = new AuthService();
      expect(service.isAuthenticated()).toBe(false);
    });

    it('should ignore incomplete stored session', () => {
      localStorageMock['starcounter-bluesky-session'] = JSON.stringify({
        accessJwt: 'token',
        // missing other fields
      });

      const service = new AuthService();
      expect(service.isAuthenticated()).toBe(false);
    });
  });

  describe('login', () => {
    it('should login successfully', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessJwt: 'access-token',
          refreshJwt: 'refresh-token',
          did: 'did:plc:test',
          handle: 'test.bsky.social',
        }),
      });

      const service = new AuthService();
      const result = await service.login('test.bsky.social', 'app-password');

      expect(result.ok).toBe(true);
      expect(service.isAuthenticated()).toBe(true);
      expect(service.getSession()?.handle).toBe('test.bsky.social');
    });

    it('should persist session to localStorage on login', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessJwt: 'access-token',
          refreshJwt: 'refresh-token',
          did: 'did:plc:test',
          handle: 'test.bsky.social',
        }),
      });

      const service = new AuthService();
      await service.login('test', 'password');

      const stored = JSON.parse(localStorageMock['starcounter-bluesky-session'] || '{}');
      expect(stored.handle).toBe('test.bsky.social');
    });

    it('should handle login failure with error message', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Invalid credentials' }),
      });

      const service = new AuthService();
      const result = await service.login('test', 'wrong-password');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Invalid credentials');
      }
      expect(service.isAuthenticated()).toBe(false);
    });

    it('should handle login failure without error message', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      const service = new AuthService();
      const result = await service.login('test', 'password');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('HTTP 500');
      }
    });

    it('should handle network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const service = new AuthService();
      const result = await service.login('test', 'password');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Network error');
      }
    });

    it('should call correct endpoint', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessJwt: 'token',
          refreshJwt: 'refresh',
          did: 'did:plc:test',
          handle: 'test.bsky.social',
        }),
      });

      const service = new AuthService();
      await service.login('test.bsky.social', 'password');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://bsky.social/xrpc/com.atproto.server.createSession',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: 'test.bsky.social', password: 'password' }),
        })
      );
    });
  });

  describe('logout', () => {
    it('should clear session on logout', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessJwt: 'token',
          refreshJwt: 'refresh',
          did: 'did:plc:test',
          handle: 'test.bsky.social',
        }),
      });

      const service = new AuthService();
      await service.login('test', 'password');
      expect(service.isAuthenticated()).toBe(true);

      service.logout();
      expect(service.isAuthenticated()).toBe(false);
      expect(service.getSession()).toBeNull();
    });

    it('should remove session from localStorage on logout', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessJwt: 'token',
          refreshJwt: 'refresh',
          did: 'did:plc:test',
          handle: 'test.bsky.social',
        }),
      });

      const service = new AuthService();
      await service.login('test', 'password');
      expect(localStorageMock['starcounter-bluesky-session']).toBeDefined();

      service.logout();
      expect(localStorageMock['starcounter-bluesky-session']).toBeUndefined();
    });
  });

  describe('onSessionChange', () => {
    it('should notify callbacks on login', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessJwt: 'token',
          refreshJwt: 'refresh',
          did: 'did:plc:test',
          handle: 'test.bsky.social',
        }),
      });

      const callback = vi.fn();
      const service = new AuthService();
      service.onSessionChange(callback);

      await service.login('test', 'password');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ handle: 'test.bsky.social' })
      );
    });

    it('should notify callbacks on logout', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessJwt: 'token',
          refreshJwt: 'refresh',
          did: 'did:plc:test',
          handle: 'test.bsky.social',
        }),
      });

      const callback = vi.fn();
      const service = new AuthService();
      service.onSessionChange(callback);

      await service.login('test', 'password');
      callback.mockClear();

      service.logout();
      expect(callback).toHaveBeenCalledWith(null);
    });

    it('should support multiple callbacks', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessJwt: 'token',
          refreshJwt: 'refresh',
          did: 'did:plc:test',
          handle: 'test.bsky.social',
        }),
      });

      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const service = new AuthService();
      service.onSessionChange(callback1);
      service.onSessionChange(callback2);

      await service.login('test', 'password');

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });
  });
});
