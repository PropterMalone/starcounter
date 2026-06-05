import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSession, refreshSession, SessionManager } from './bluesky-auth';

const MOCK_SESSION = {
  did: 'did:plc:testbot123',
  handle: 'starcountr.bsky.social',
  accessJwt: 'access-jwt-token',
  refreshJwt: 'refresh-jwt-token',
};

const MOCK_REFRESHED_SESSION = {
  did: 'did:plc:testbot123',
  handle: 'starcountr.bsky.social',
  accessJwt: 'new-access-jwt',
  refreshJwt: 'new-refresh-jwt',
};

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('createSession', () => {
  it('returns session on successful login', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_SESSION),
    });

    const result = await createSession({
      handle: 'starcountr.bsky.social',
      password: 'app-password',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.did).toBe(MOCK_SESSION.did);
      expect(result.value.accessJwt).toBe(MOCK_SESSION.accessJwt);
      expect(result.value.refreshJwt).toBe(MOCK_SESSION.refreshJwt);
    }
  });

  it('sends correct request body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_SESSION),
    });

    await createSession({
      handle: 'my.handle',
      password: 'my-password',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://bsky.social/xrpc/com.atproto.server.createSession',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'my.handle', password: 'my-password' }),
      })
    );
  });

  it('uses custom service URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_SESSION),
    });

    await createSession({
      handle: 'test',
      password: 'pass',
      service: 'https://custom.pds.example',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://custom.pds.example/xrpc/com.atproto.server.createSession',
      expect.anything()
    );
  });

  it('returns error on failed login', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('{"error":"AuthenticationRequired"}'),
    });

    const result = await createSession({
      handle: 'bad',
      password: 'wrong',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('401');
      expect(result.status).toBe(401);
    }
  });
});

describe('refreshSession', () => {
  it('returns refreshed session on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_REFRESHED_SESSION),
    });

    const result = await refreshSession('old-refresh-token');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.accessJwt).toBe('new-access-jwt');
      expect(result.value.refreshJwt).toBe('new-refresh-jwt');
    }
  });

  it('sends refresh token as Bearer auth', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_REFRESHED_SESSION),
    });

    await refreshSession('my-refresh-token');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://bsky.social/xrpc/com.atproto.server.refreshSession',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer my-refresh-token' },
      })
    );
  });

  it('uses custom service URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_REFRESHED_SESSION),
    });

    await refreshSession('token', 'https://custom.pds.example');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://custom.pds.example/xrpc/com.atproto.server.refreshSession',
      expect.anything()
    );
  });

  it('returns error on failed refresh', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"error":"ExpiredToken"}'),
    });

    const result = await refreshSession('expired-token');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('400');
      expect(result.status).toBe(400);
    }
  });
});

describe('SessionManager', () => {
  it('creates session on first getAccessToken call', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_SESSION),
    });

    const manager = new SessionManager({
      handle: 'starcountr.bsky.social',
      password: 'app-pass',
    });

    const result = await manager.getAccessToken();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(MOCK_SESSION.accessJwt);
    }
    expect(manager.getDid()).toBe(MOCK_SESSION.did);
  });

  it('refreshes session on subsequent calls', async () => {
    // First call: createSession
    // Second call: refreshSession
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_SESSION),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_REFRESHED_SESSION),
      });

    const manager = new SessionManager({
      handle: 'starcountr.bsky.social',
      password: 'app-pass',
    });

    await manager.getAccessToken(); // creates session
    const result = await manager.getAccessToken(); // refreshes

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(MOCK_REFRESHED_SESSION.accessJwt);
    }
  });

  it('falls back to fresh login when refresh fails', async () => {
    // First call: createSession (success)
    // Second call: refreshSession (fail)
    // Third call: createSession (success with new tokens)
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_SESSION),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('ExpiredToken'),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_REFRESHED_SESSION),
      });

    const manager = new SessionManager({
      handle: 'starcountr.bsky.social',
      password: 'app-pass',
    });

    await manager.getAccessToken(); // creates session
    const result = await manager.getAccessToken(); // refresh fails, re-login

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(MOCK_REFRESHED_SESSION.accessJwt);
    }
  });

  it('returns error when both refresh and login fail', async () => {
    // First call: createSession (success)
    // Second call: refreshSession (fail)
    // Third call: createSession (fail)
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_SESSION),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('ExpiredToken'),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('InternalError'),
      });

    const manager = new SessionManager({
      handle: 'starcountr.bsky.social',
      password: 'app-pass',
    });

    await manager.getAccessToken(); // success
    const result = await manager.getAccessToken(); // both fail

    expect(result.ok).toBe(false);
  });

  it('returns null DID before authentication', () => {
    const manager = new SessionManager({
      handle: 'starcountr.bsky.social',
      password: 'app-pass',
    });

    expect(manager.getDid()).toBeNull();
    expect(manager.getSession()).toBeNull();
  });

  it('exposes session after authentication', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_SESSION),
    });

    const manager = new SessionManager({
      handle: 'starcountr.bsky.social',
      password: 'app-pass',
    });

    await manager.getAccessToken();

    const session = manager.getSession();
    expect(session).not.toBeNull();
    expect(session!.did).toBe(MOCK_SESSION.did);
    expect(session!.handle).toBe(MOCK_SESSION.handle);
  });
});
