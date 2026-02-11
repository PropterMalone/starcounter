import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateMention } from './validate';
import handler from './validate';
import { MediaType } from '../../src/lib/mention-extractor';

// Type for mocked fetch
type MockedFetch = ReturnType<typeof vi.fn>;

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

    it('should reject repeated-word titles from MusicBrainz', async () => {
      // MusicBrainz returns "Fear Fear Fear" as top result for "Fear"
      const mockResponse = {
        recordings: [
          { id: 'r1', title: 'Fear Fear Fear', score: 100 },
          { id: 'r2', title: 'Fear, Fear, Fear', score: 100 },
          { id: 'r3', title: 'Fear Fear', score: 96 },
          { id: 'r4', title: 'Fear of Fear', score: 88 },
        ],
      };

      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await validateMention('Fear', MediaType.SONG, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      // None of the results match well enough (all score < 75)
      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should pick best matching title from MusicBrainz results', async () => {
      const mockResponse = {
        recordings: [
          { id: 'r1', title: 'Jolene Jolene Jolene', score: 100 },
          { id: 'r2', title: 'Jolene', score: 95, 'artist-credit': [{ name: 'Dolly Parton' }] },
          { id: 'r3', title: 'Jolene (Live)', score: 90 },
        ],
      };

      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await validateMention('Jolene', MediaType.SONG, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.title).toBe('Jolene'); // Exact match preferred over "Jolene Jolene Jolene"
      expect(result.artist).toBe('Dolly Parton');
    });

    it('should request 20 results from MusicBrainz', async () => {
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
      expect(callUrl).toContain('limit=20');
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

    it('should handle non-Error exceptions in POST handler (line 762)', async () => {
      // Line 762: error instanceof Error ? error.message : 'Unknown error'
      // Force request.json() to throw a non-Error object
      const request = {
        method: 'POST',
        json: vi.fn().mockRejectedValueOnce('string error'), // Throw string, not Error
      };

      const response = await handler.fetch(request as unknown as Request, {
        TMDB_API_KEY: 'test',
        MUSICBRAINZ_USER_AGENT: 'test',
        TWITCH_CLIENT_ID: 'test_twitch_id',
        TWITCH_CLIENT_SECRET: 'test_twitch_secret',
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Unknown error'); // Should use fallback
    });
  });

  describe('scoreTitleMatch edge cases', () => {
    it('should reject when search contains result but result is too short', async () => {
      // Searching "Oceans Eleven" should NOT match "Oceans" (length ratio 0.46 < 0.6)
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Oceans',
              vote_count: 1000,
              popularity: 50,
            },
          ],
        }),
      });

      const result = await validateMention('Oceans Eleven', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      // Result is too short relative to search (6 vs 13 chars = 0.46 ratio < 0.6)
      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should use partial word matching as fallback', async () => {
      // Result shares 50% of words with search but no phrase match
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Star Trek Discovery',
              vote_count: 1000,
              popularity: 50,
            },
          ],
        }),
      });

      const result = await validateMention('Star Wars Discovery', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      // Partial word match: 2 of 3 words match ("Star", "Discovery")
      expect(result.validated).toBe(true);
    });
  });

  describe('MusicBrainz rejection cases', () => {
    it('should reject generic single-word SONG titles', async () => {
      const result = await validateMention('love', MediaType.SONG, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should reject very short SONG titles', async () => {
      const result = await validateMention('AB', MediaType.SONG, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should reject generic single-word ALBUM titles', async () => {
      const result = await validateMention('love', MediaType.ALBUM, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should reject very short ALBUM titles', async () => {
      const result = await validateMention('XY', MediaType.ALBUM, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should reject generic single-word ARTIST names', async () => {
      const result = await validateMention('love', MediaType.ARTIST, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should reject very short ARTIST names', async () => {
      const result = await validateMention('AB', MediaType.ARTIST, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });
  });

  describe('scoreTitleMatch additional cases', () => {
    it('should handle search containing result with passing length ratio', async () => {
      // "The Matrix" (10 chars) contains "Matrix" (6 chars) - ratio 0.6 (passes)
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Matrix',
              vote_count: 1000,
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

      // Length ratio is exactly 0.6, should pass
      expect(result.validated).toBe(true);
    });

    it('should apply penalty when search contains result with extra chars', async () => {
      // "Matrix Reloaded" (15 chars) contains "Matrix" (6 chars) - ratio 0.4 fails
      // But "The Matrix Extended" (21 chars) contains "The Matrix" (10 chars) - ratio 0.476 fails
      // Try "Blues Brothers Band" (18) contains "Blues Brothers" (14) - ratio 0.77 passes
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Blues Brothers',
              vote_count: 1000,
              popularity: 50,
            },
          ],
        }),
      });

      const result = await validateMention('Blues Brothers Band', MediaType.MOVIE, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      // Length ratio 14/18 = 0.77 (passes), penalty applied for 4 extra chars
      expect(result.validated).toBe(true);
    });
  });

  describe('unknown media type handling', () => {
    it('should return error for completely invalid media type', async () => {
      const result = await validateMention('Test', 'INVALID_TYPE' as unknown as MediaType, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      // Falls through to the else clause (line 142)
      expect(result.validated).toBe(false);
      expect(result.error).toBe('Unknown media type');
    });
  });

  describe('MusicBrainz edge cases for branch coverage', () => {
    it('should pick second result when it scores higher than first (line 529 branch)', async () => {
      // Line 529: score > bestMatch.score replacement branch
      // Mock MusicBrainz returning multiple results where 2nd one scores higher
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          recordings: [
            {
              id: 'r1',
              title: 'Bohemian Rhapsody Live',
              score: 100,
              'artist-credit': [{ name: 'Queen' }],
            },
            {
              id: 'r2',
              title: 'Bohemian Rhapsody',
              score: 100,
              'artist-credit': [{ name: 'Queen' }],
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

      // 2nd result is exact match (scores 100 from exact match) vs 1st (scores lower due to "Live")
      // bestMatch should be replaced when 2nd result scores better
      expect(result.validated).toBe(true);
      expect(result.title).toBe('Bohemian Rhapsody'); // Exact match preferred
    });

    it('should handle MusicBrainz result without score field (line 535 ?? 0)', async () => {
      // Line 535: bestMatch.result.score ?? 0 fallback
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          recordings: [
            {
              id: 'r1',
              title: 'Test Song',
              // score field is missing
              'artist-credit': [{ name: 'Test Artist' }],
            },
          ],
        }),
      });

      const result = await validateMention('Test Song', MediaType.MUSIC, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      // Should use 0 as fallback score and calculate confidence from that
      expect(result.validated).toBe(true);
      expect(result.confidence).toBe('low'); // score 0 gives low confidence
    });
  });

  describe('IGDB edge cases', () => {
    const mockIGDBCalls = (igdbResponse: unknown[]) => {
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'mock_token' }),
      });
      (global.fetch as unknown as MockedFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => igdbResponse,
      });
    };

    it('should pick second IGDB result when it scores higher (line 656 branch)', async () => {
      // Line 656: score > bestMatch.score replacement branch for IGDB
      mockIGDBCalls([
        {
          id: 1,
          name: 'Elden Ring Complete Edition',
          rating_count: 1000,
        },
        {
          id: 2,
          name: 'Elden Ring',
          rating_count: 1000,
        },
      ]);

      const result = await validateMention('Elden Ring', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      // 2nd result is exact match, should score higher and replace bestMatch
      expect(result.validated).toBe(true);
      expect(result.title).toBe('Elden Ring'); // Exact match preferred
    });

    it('should handle IGDB result with missing name field', async () => {
      mockIGDBCalls([
        {
          id: 12345,
          // name is missing (lines 653-654 uncovered)
          slug: 'some-game',
          rating_count: 1000,
        },
      ]);

      const result = await validateMention('Some Game', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      // Result with empty name gets score 0, so no match
      expect(result.validated).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should return high confidence for game with exactly 50 user ratings and 5 critic ratings', async () => {
      // Line 701: (ratingCount >= 50 && aggregatedRatingCount >= 5) returns high
      mockIGDBCalls([
        {
          id: 12345,
          name: 'Borderline Game',
          rating_count: 50, // Exactly 50
          aggregated_rating_count: 5, // Exactly 5
        },
      ]);

      const result = await validateMention('Borderline Game', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      // 50 >= 50 AND 5 >= 5, so high confidence (line 701)
      expect(result.validated).toBe(true);
      expect(result.confidence).toBe('high');
    });

    it('should return medium confidence for game just below high threshold', async () => {
      // Line 706: Doesn't meet high threshold but meets medium
      mockIGDBCalls([
        {
          id: 12345,
          name: 'Medium Game',
          rating_count: 49, // Just below 50
          aggregated_rating_count: 5,
        },
      ]);

      const result = await validateMention('Medium Game', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      // 49 < 50, so not high. totalRatings = 54 >= 20, so medium (line 706)
      expect(result.validated).toBe(true);
      expect(result.confidence).toBe('medium');
    });

    it('should return medium confidence for game with exactly 3 critic ratings', async () => {
      // Line 706: aggregatedRatingCount >= 3
      mockIGDBCalls([
        {
          id: 12345,
          name: 'Critic Favorite',
          rating_count: 0,
          aggregated_rating_count: 3, // Exactly 3
        },
      ]);

      const result = await validateMention('Critic Favorite', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      // aggregatedRatingCount >= 3, so medium confidence
      expect(result.validated).toBe(true);
      expect(result.confidence).toBe('medium');
    });

    it('should return medium confidence for game with exactly 20 total ratings', async () => {
      // Line 706: totalRatings >= 20
      mockIGDBCalls([
        {
          id: 12345,
          name: 'Moderately Rated',
          rating_count: 18,
          aggregated_rating_count: 2,
          // totalRatings = 20
        },
      ]);

      const result = await validateMention('Moderately Rated', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      // totalRatings = 20 >= 20, so medium confidence
      expect(result.validated).toBe(true);
      expect(result.confidence).toBe('medium');
    });

    it('should convert IGDB first_release_date to ISO date string', async () => {
      // Line 665-667: date conversion
      mockIGDBCalls([
        {
          id: 3498,
          name: 'Test Game',
          first_release_date: 1379376000, // 2013-09-17 00:00:00 UTC
          rating_count: 1000,
        },
      ]);

      const result = await validateMention('Test Game', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.metadata?.releaseDate).toBe('2013-09-17');
    });

    it('should handle IGDB result without first_release_date', async () => {
      // Line 665-667: releaseDate is undefined when first_release_date is missing
      mockIGDBCalls([
        {
          id: 12345,
          name: 'Unreleased Game',
          // first_release_date is missing
          rating_count: 100,
        },
      ]);

      const result = await validateMention('Unreleased Game', MediaType.VIDEO_GAME, {
        tmdbApiKey: 'test_key',
        musicbrainzUserAgent: 'Test/1.0',
        twitchClientId: 'test_twitch_id',
        twitchClientSecret: 'test_twitch_secret',
      });

      expect(result.validated).toBe(true);
      expect(result.metadata?.releaseDate).toBeUndefined();
    });
  });
});
