import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateMention } from './validate';
import handler from './validate';
import { MediaType } from '../../src/lib/mention-extractor';

// Type for mocked fetch
type MockedFetch = ReturnType<typeof vi.fn>;

// Type for KV namespace
interface KVNamespace {
  get(key: string, options?: { type: string }): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl: number }): Promise<void>;
}

// Mock fetch globally
global.fetch = vi.fn() as unknown as typeof fetch;

describe('validateMention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('TMDB movie validation', () => {
    it('should validate movie against TMDB', async () => {
      const mockResponse = {
        results: [
          {
            id: 603,
            title: 'The Matrix',
            release_date: '1999-03-31',
            vote_average: 8.2,
            vote_count: 21500,
            popularity: 45.6,
          },
        ],
      };

      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await validateMention('The Matrix', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.title).toBe('The Matrix');
      expect(result.confidence).toBe('high');
      expect(result.source).toBe('tmdb');
    });

    it('should return low confidence for no matches', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      const result = await validateMention('Nonexistent Movie', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should reject generic single-word movie titles', async () => {
      const result = await validateMention('love', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should reject cruft phrases like "dad movie"', async () => {
      const result = await validateMention('dad movie', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should reject very short movie titles', async () => {
      const result = await validateMention('AB', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should return false when TMDB results exist but none match', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 99999,
              title: 'Xyz Qwerty Zyx',
              vote_count: 1000,
              popularity: 50,
            },
          ],
        }),
      });

      const result = await validateMention('Elden Ring', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });
  });

  describe('TMDB TV show validation', () => {
    it('should validate TV show against TMDB', async () => {
      const mockResponse = {
        results: [
          {
            id: 1396,
            name: 'Breaking Bad',
            first_air_date: '2008-01-20',
            vote_average: 9.5,
            vote_count: 10500,
            popularity: 120.5,
          },
        ],
      };

      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await validateMention('Breaking Bad', MediaType.TV_SHOW, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.title).toBe('Breaking Bad');
      expect(result.source).toBe('tmdb');
    });
  });

  describe('MusicBrainz validation', () => {
    it('should validate music against MusicBrainz', async () => {
      const mockResponse = {
        recordings: [
          {
            id: 'abc-123',
            title: 'Bohemian Rhapsody',
            score: 100,
            'artist-credit': [
              {
                name: 'Queen',
                artist: { id: 'def-456', name: 'Queen' },
              },
            ],
          },
        ],
      };

      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await validateMention('Bohemian Rhapsody', MediaType.MUSIC, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.title).toBe('Bohemian Rhapsody');
      expect(result.artist).toBe('Queen');
      expect(result.source).toBe('musicbrainz');
    });

    it('should validate SONG type via recording endpoint', async () => {
      const mockResponse = {
        recordings: [
          {
            id: 'rec-789',
            title: 'Stairway to Heaven',
            score: 95,
            'artist-credit': [{ name: 'Led Zeppelin' }],
          },
        ],
      };

      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await validateMention('Stairway to Heaven', MediaType.SONG, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.title).toBe('Stairway to Heaven');
      expect(result.artist).toBe('Led Zeppelin');

      const callUrl = (
        (global.fetch as unknown as MockedFetch).mock.calls[0] as unknown[]
      )[0] as string;
      expect(callUrl).toContain('/recording/');
    });

    it('should use fuzzy search for MusicBrainz', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ recordings: [] }),
      });

      await validateMention('Bohemian Rhapsody', MediaType.MUSIC, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      const callUrl = (
        (global.fetch as unknown as MockedFetch).mock.calls[0] as unknown[]
      )[0] as string;
      expect(callUrl).toContain('~'); // Fuzzy operator
    });
  });

  describe('MusicBrainz album validation', () => {
    it('should search the release endpoint for ALBUM type', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          releases: [
            {
              id: 'rel-123',
              title: 'Abbey Road',
              score: 95,
              'artist-credit': [{ name: 'The Beatles' }],
            },
          ],
        }),
      });

      const result = await validateMention('Abbey Road', MediaType.ALBUM, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.title).toBe('Abbey Road');
      expect(result.artist).toBe('The Beatles');
      expect(result.source).toBe('musicbrainz');

      const callUrl = (
        (global.fetch as unknown as MockedFetch).mock.calls[0] as unknown[]
      )[0] as string;
      expect(callUrl).toContain('/release/');
      expect(callUrl).toContain('release%3A');
    });

    it('should return low confidence when no releases match', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ releases: [] }),
      });

      const result = await validateMention('Nonexistent Album', MediaType.ALBUM, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });
  });

  describe('MusicBrainz artist validation', () => {
    it('should search the artist endpoint for ARTIST type', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          artists: [
            {
              id: 'art-456',
              name: 'Radiohead',
              'sort-name': 'Radiohead',
              score: 100,
            },
          ],
        }),
      });

      const result = await validateMention('Radiohead', MediaType.ARTIST, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.title).toBe('Radiohead');
      expect(result.source).toBe('musicbrainz');

      const callUrl = (
        (global.fetch as unknown as MockedFetch).mock.calls[0] as unknown[]
      )[0] as string;
      expect(callUrl).toContain('/artist/');
      expect(callUrl).toContain('artist%3A');
    });

    it('should return low confidence when no artists match', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ artists: [] }),
      });

      const result = await validateMention('Nonexistent Artist', MediaType.ARTIST, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });
  });

  describe('IGDB video game validation', () => {
    // Helper to mock both Twitch OAuth and IGDB API calls
    const mockIGDBCalls = (igdbResponse: unknown[]) => {
      // First call: Twitch OAuth token
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'mock_token' }),
      });
      // Second call: IGDB API
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => igdbResponse,
      });
    };

    it('should validate video game against IGDB', async () => {
      mockIGDBCalls([
        {
          id: 3498,
          name: 'Grand Theft Auto V',
          slug: 'grand-theft-auto-v',
          first_release_date: 1379376000, // 2013-09-17
          rating: 92,
          rating_count: 600,
          aggregated_rating: 97,
          aggregated_rating_count: 10,
          total_rating: 94,
        },
      ]);

      const result = await validateMention('Grand Theft Auto V', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.title).toBe('Grand Theft Auto V');
      expect(result.confidence).toBe('high');
      expect(result.source).toBe('igdb');
      expect(result.metadata?.voteAverage).toBe(9.4); // 94 / 10
    });

    it('should return low confidence for no matches', async () => {
      mockIGDBCalls([]);

      const result = await validateMention('Nonexistent Game', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should return medium confidence for games with some ratings', async () => {
      mockIGDBCalls([
        {
          id: 12345,
          name: 'Indie Game',
          rating_count: 30,
          aggregated_rating_count: 5,
        },
      ]);

      const result = await validateMention('Indie Game', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.confidence).toBe('medium');
    });

    it('should handle Twitch OAuth errors', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const result = await validateMention('Some Game', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.error).toContain('Twitch OAuth error');
    });

    it('should handle IGDB API errors', async () => {
      // Twitch OAuth succeeds
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'mock_token' }),
      });
      // IGDB fails
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await validateMention('Some Game', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.error).toContain('IGDB API error');
    });

    it('should reject very short titles', async () => {
      const result = await validateMention('A', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should reject generic single-word titles', async () => {
      const result = await validateMention('love', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should return low confidence for games with few ratings', async () => {
      mockIGDBCalls([
        {
          id: 99999,
          name: 'Obscure Game',
          rating_count: 5,
          aggregated_rating_count: 0,
        },
      ]);

      const result = await validateMention('Obscure Game', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.confidence).toBe('low');
    });

    it('should return false when title match score is zero', async () => {
      mockIGDBCalls([
        {
          id: 12345,
          name: 'Xyz Abc Qwerty',
          rating_count: 1000,
        },
      ]);

      const result = await validateMention('Elden Ring', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });
  });

  describe('confidence scoring', () => {
    it('should return high confidence for exact matches', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'The Matrix',
              vote_count: 20000,
              popularity: 50,
            },
          ],
        }),
      });

      const result = await validateMention('The Matrix', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.confidence).toBe('high');
    });

    it('should return medium confidence for popular but weak matches', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Matrix',
              vote_count: 500,
              popularity: 10,
            },
          ],
        }),
      });

      const result = await validateMention('The Matrix', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.confidence).toBe('medium');
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      (global.fetch as unknown as MockedFetch).mockRejectedValueOnce(new Error('Network error'));

      const result = await validateMention('The Matrix', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should handle API errors', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await validateMention('The Matrix', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe('cache behavior', () => {
    it('should use cache for subsequent calls', async () => {
      const mockKV = {
        get: vi.fn(),
        put: vi.fn(),
      };

      const mockResponse = {
        results: [
          {
            id: 603,
            title: 'The Matrix',
            release_date: '1999-03-31',
            vote_average: 8.2,
            vote_count: 21500,
            popularity: 45.6,
          },
        ],
      };

      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await validateMention('The Matrix', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
        cache: mockKV as unknown as KVNamespace,
      });

      expect(mockKV.put).toHaveBeenCalled();
    });

    it('should return cached result on hit', async () => {
      const cachedResult = {
        title: 'The Matrix',
        validated: true,
        confidence: 'high' as const,
        source: 'tmdb' as const,
      };

      const mockKV = {
        get: vi.fn().mockResolvedValueOnce(cachedResult),
        put: vi.fn(),
      };

      const result = await validateMention('The Matrix', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
        cache: mockKV as unknown as KVNamespace,
      });

      expect(result).toEqual(cachedResult);
      expect(((global.fetch as unknown as MockedFetch).mock.calls as unknown[][]).length).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle TMDB with missing vote_count', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'The Matrix',
              release_date: '1999-03-31',
              popularity: 10,
            },
          ],
        }),
      });

      const result = await validateMention('The Matrix', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.confidence).toBe('medium');
    });

    it('should handle MusicBrainz without artist-credit', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          recordings: [
            {
              id: 'abc-123',
              title: 'Bohemian Rhapsody',
              score: 90,
            },
          ],
        }),
      });

      const result = await validateMention('Bohemian Rhapsody', MediaType.MUSIC, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.artist).toBeUndefined();
    });

    it('should handle UNKNOWN media type by defaulting to MOVIE search', async () => {
      // UNKNOWN media type falls back to MOVIE validation
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }), // No matches
      });

      const result = await validateMention('Unknown Title', 'UNKNOWN' as unknown as MediaType, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      // Should attempt TMDB search (returns low confidence on no match)
      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
      expect(result.error).toBeUndefined();
    });

    it('should return low confidence for MusicBrainz with low score', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          recordings: [
            {
              id: 'abc-123',
              title: 'Bohemian Rhapsody',
              score: 30,
              'artist-credit': [
                {
                  name: 'Queen',
                },
              ],
            },
          ],
        }),
      });

      const result = await validateMention('Bohemian Rhapsody', MediaType.MUSIC, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.confidence).toBe('low');
    });

    it('should return medium confidence for MusicBrainz with medium score', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          recordings: [
            {
              id: 'abc-123',
              title: 'Bohemian Rhapsody',
              score: 65,
              'artist-credit': [
                {
                  name: 'Queen',
                },
              ],
            },
          ],
        }),
      });

      const result = await validateMention('Bohemian Rhapsody', MediaType.MUSIC, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.confidence).toBe('medium');
    });

    it('should handle TMDB with low votes and popularity', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Obscure Movie',
              vote_count: 10,
              popularity: 1,
            },
          ],
        }),
      });

      const result = await validateMention('Obscure Movie', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.confidence).toBe('low');
    });

    it('should handle TMDB error response', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await validateMention('The Matrix', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.error).toContain('TMDB API error');
    });

    it('should handle MusicBrainz error response', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const result = await validateMention('Bohemian Rhapsody', MediaType.MUSIC, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.error).toContain('MusicBrainz API error');
    });
  });

  describe('Cloudflare Worker handler', () => {
    it('should handle OPTIONS request with CORS headers', async () => {
      const request = new Request('http://localhost/validate', {
        method: 'OPTIONS',
      });

      const response = await handler.fetch(request, {
        TMDB_API_KEY: 'test',
        MUSICBRAINZ_USER_AGENT: 'test',
        TWITCH_CLIENT_ID: 'test_twitch_id',
        TWITCH_CLIENT_SECRET: 'test_twitch_secret',
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should reject non-POST/OPTIONS requests', async () => {
      const request = new Request('http://localhost/validate', {
        method: 'GET',
      });

      const response = await handler.fetch(request, {
        TMDB_API_KEY: 'test',
        MUSICBRAINZ_USER_AGENT: 'test',
        TWITCH_CLIENT_ID: 'test_twitch_id',
        TWITCH_CLIENT_SECRET: 'test_twitch_secret',
      });

      expect(response.status).toBe(405);
    });

    it('should return 400 for missing title', async () => {
      const request = new Request('http://localhost/validate', {
        method: 'POST',
        body: JSON.stringify({ mediaType: 'MOVIE' }),
      });

      const response = await handler.fetch(request, {
        TMDB_API_KEY: 'test',
        MUSICBRAINZ_USER_AGENT: 'test',
        TWITCH_CLIENT_ID: 'test_twitch_id',
        TWITCH_CLIENT_SECRET: 'test_twitch_secret',
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing mediaType', async () => {
      const request = new Request('http://localhost/validate', {
        method: 'POST',
        body: JSON.stringify({ title: 'The Matrix' }),
      });

      const response = await handler.fetch(request, {
        TMDB_API_KEY: 'test',
        MUSICBRAINZ_USER_AGENT: 'test',
        TWITCH_CLIENT_ID: 'test_twitch_id',
        TWITCH_CLIENT_SECRET: 'test_twitch_secret',
      });

      expect(response.status).toBe(400);
    });

    it('should validate and return result on POST', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 603,
              title: 'The Matrix',
              release_date: '1999-03-31',
              vote_average: 8.2,
              vote_count: 21500,
              popularity: 45.6,
            },
          ],
        }),
      });

      const request = new Request('http://localhost/validate', {
        method: 'POST',
        body: JSON.stringify({ title: 'The Matrix', mediaType: 'MOVIE' }),
      });

      const response = await handler.fetch(request, {
        TMDB_API_KEY: 'test_key',
        MUSICBRAINZ_USER_AGENT: 'test',
        TWITCH_CLIENT_ID: 'test_twitch_id',
        TWITCH_CLIENT_SECRET: 'test_twitch_secret',
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');
      const data = await response.json();
      expect(data.validated).toBe(true);
    });

    it('should handle invalid JSON in POST body', async () => {
      const request = new Request('http://localhost/validate', {
        method: 'POST',
        body: 'invalid json',
      });

      const response = await handler.fetch(request, {
        TMDB_API_KEY: 'test',
        MUSICBRAINZ_USER_AGENT: 'test',
        TWITCH_CLIENT_ID: 'test_twitch_id',
        TWITCH_CLIENT_SECRET: 'test_twitch_secret',
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBeTruthy();
    });
  });

  describe('branch coverage for cache miss', () => {
    it('should call API when cache returns null', async () => {
      const mockKV = {
        get: vi.fn().mockResolvedValueOnce(null),
        put: vi.fn(),
      };

      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 603,
              title: 'The Matrix',
              release_date: '1999-03-31',
              vote_average: 8.2,
              vote_count: 21500,
              popularity: 45.6,
            },
          ],
        }),
      });

      const result = await validateMention('The Matrix', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
        cache: mockKV as unknown as KVNamespace,
      });

      expect(result.validated).toBe(true);
      expect(((global.fetch as unknown as MockedFetch).mock.calls as unknown[][]).length).toBe(1);
    });

    it('should validate when cache is undefined', async () => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 603,
              title: 'The Matrix',
              release_date: '1999-03-31',
              vote_average: 8.2,
              vote_count: 21500,
              popularity: 45.6,
            },
          ],
        }),
      });

      const result = await validateMention('The Matrix', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
    });
  });
});
