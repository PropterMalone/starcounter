// Cloudflare Worker environment bindings

export type Env = {
  readonly SHARED_RESULTS: D1Database;
  readonly BSKY_HANDLE: string;
  readonly BSKY_PASSWORD: string;
};
