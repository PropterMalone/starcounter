// Bluesky authentication via raw HTTP — no @atproto/api dependency.
// Uses createSession/refreshSession XRPC endpoints.

const BSKY_SERVICE = 'https://bsky.social';

export type Session = {
  readonly did: string;
  readonly handle: string;
  readonly accessJwt: string;
  readonly refreshJwt: string;
};

export type AuthConfig = {
  readonly handle: string;
  readonly password: string;
  readonly service?: string;
};

export type AuthResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string; readonly status?: number };

/**
 * Create a new session (login).
 * POST com.atproto.server.createSession
 */
export async function createSession(config: AuthConfig): Promise<AuthResult<Session>> {
  const service = config.service ?? BSKY_SERVICE;

  const res = await fetch(`${service}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: config.handle,
      password: config.password,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `createSession failed: ${res.status} ${body}`, status: res.status };
  }

  const data = (await res.json()) as {
    did: string;
    handle: string;
    accessJwt: string;
    refreshJwt: string;
  };

  return {
    ok: true,
    value: {
      did: data.did,
      handle: data.handle,
      accessJwt: data.accessJwt,
      refreshJwt: data.refreshJwt,
    },
  };
}

/**
 * Refresh an existing session using the refresh token.
 * POST com.atproto.server.refreshSession
 */
export async function refreshSession(
  refreshJwt: string,
  service?: string
): Promise<AuthResult<Session>> {
  const svc = service ?? BSKY_SERVICE;

  const res = await fetch(`${svc}/xrpc/com.atproto.server.refreshSession`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${refreshJwt}` },
  });

  if (!res.ok) {
    const body = await res.text();
    return {
      ok: false,
      error: `refreshSession failed: ${res.status} ${body}`,
      status: res.status,
    };
  }

  const data = (await res.json()) as {
    did: string;
    handle: string;
    accessJwt: string;
    refreshJwt: string;
  };

  return {
    ok: true,
    value: {
      did: data.did,
      handle: data.handle,
      accessJwt: data.accessJwt,
      refreshJwt: data.refreshJwt,
    },
  };
}

/**
 * Manages a Bluesky session with automatic token refresh.
 * Holds mutable session state — create one per Worker invocation.
 */
export class SessionManager {
  private session: Session | null = null;
  private readonly config: AuthConfig;
  private readonly service: string;

  constructor(config: AuthConfig) {
    this.config = config;
    this.service = config.service ?? BSKY_SERVICE;
  }

  /** Get a valid access token, refreshing or creating as needed. */
  async getAccessToken(): Promise<AuthResult<string>> {
    if (this.session) {
      // Try refresh first
      const refreshResult = await refreshSession(this.session.refreshJwt, this.service);
      if (refreshResult.ok) {
        this.session = refreshResult.value;
        return { ok: true, value: this.session.accessJwt };
      }
      // Refresh failed — fall through to fresh login
    }

    const loginResult = await createSession(this.config);
    if (!loginResult.ok) {
      return loginResult;
    }
    this.session = loginResult.value;
    return { ok: true, value: this.session.accessJwt };
  }

  /** Get the current DID, or null if not authenticated. */
  getDid(): string | null {
    return this.session?.did ?? null;
  }

  /** Get the current session, or null if not authenticated. */
  getSession(): Session | null {
    return this.session;
  }
}
