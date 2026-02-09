// pattern: Imperative Shell tests - Error handling
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ShareableResults } from '../../src/lib/url-encoder';
import { encodeResults } from '../../src/lib/url-encoder';

describe('OG Image Generator Error Handling', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockImageResponse: (...args: unknown[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ogModule: any;

  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('should return 500 when ImageResponse throws Error instance', async () => {
    // Mock @cf-wasm/og to throw
    mockImageResponse = function () {
      throw new Error('render failed');
    };

    vi.doMock('@cf-wasm/og', () => ({
      ImageResponse: mockImageResponse,
    }));

    // Import module AFTER mock is set up
    ogModule = await import('./og');

    const results: ShareableResults = { m: [{ n: 'Test', c: 1 }], t: Date.now() };
    const encoded = encodeResults(results);
    const request = new Request(`https://starcounter.app/api/og?r=${encoded}`);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await ogModule.onRequest({ request });

    expect(response.status).toBe(500);
    expect(await response.text()).toContain('render failed');

    consoleSpy.mockRestore();
  });

  it('should return 500 when ImageResponse throws non-Error instance', async () => {
    // Mock @cf-wasm/og to throw string
    mockImageResponse = function () {
      throw 'string error';
    };

    vi.doMock('@cf-wasm/og', () => ({
      ImageResponse: mockImageResponse,
    }));

    // Import module AFTER mock is set up
    ogModule = await import('./og');

    const results: ShareableResults = { m: [{ n: 'Test', c: 1 }], t: Date.now() };
    const encoded = encodeResults(results);
    const request = new Request(`https://starcounter.app/api/og?r=${encoded}`);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await ogModule.onRequest({ request });

    expect(response.status).toBe(500);
    expect(await response.text()).toContain('string error');

    consoleSpy.mockRestore();
  });
});
