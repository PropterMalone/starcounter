import { describe, it, expect } from 'vitest';
import { cleanEmbedTitle, isGarbageTitle, parseEmbedTitle } from './embed-title-parser';
import type { EmbedLink } from './text-extractor';

function makeLink(title: string, platform: EmbedLink['platform'] = 'youtube'): EmbedLink {
  return { url: 'https://example.com', title, platform };
}

describe('cleanEmbedTitle', () => {
  it('strips (Official Video) suffix', () => {
    expect(cleanEmbedTitle('Song Name (Official Video)')).toBe('Song Name');
  });

  it('strips (Official Music Video)', () => {
    expect(cleanEmbedTitle('Artist - Song (Official Music Video)')).toBe('Artist - Song');
  });

  it('strips (Official Audio)', () => {
    expect(cleanEmbedTitle('Song (Official Audio)')).toBe('Song');
  });

  it('strips (Lyric Video)', () => {
    expect(cleanEmbedTitle('Song (Lyric Video)')).toBe('Song');
  });

  it('strips (Lyrics)', () => {
    expect(cleanEmbedTitle('Song (Lyrics)')).toBe('Song');
  });

  it('strips (Visualizer)', () => {
    expect(cleanEmbedTitle('Song (Visualizer)')).toBe('Song');
  });

  it('strips [Official Video] bracket form', () => {
    expect(cleanEmbedTitle('Song [Official Video]')).toBe('Song');
  });

  it('strips trailing // Lyrics', () => {
    expect(cleanEmbedTitle('Song // Lyrics')).toBe('Song');
  });

  it('strips trailing - Lyrics', () => {
    expect(cleanEmbedTitle('Song - Lyrics')).toBe('Song');
  });

  it('strips (Remastered)', () => {
    expect(cleanEmbedTitle('Song (Remastered)')).toBe('Song');
  });

  it('strips (Remastered 2009)', () => {
    expect(cleanEmbedTitle('Song (Remastered 2009)')).toBe('Song');
  });

  it('preserves year parentheticals', () => {
    expect(cleanEmbedTitle('Song (1978)')).toBe('Song (1978)');
  });

  it('strips Apple Music suffix', () => {
    expect(cleanEmbedTitle('Song on Apple Music')).toBe('Song');
  });

  it('strips Spotify suffix', () => {
    expect(cleanEmbedTitle('Song on Spotify')).toBe('Song');
  });

  it('strips YouTube trailing', () => {
    expect(cleanEmbedTitle('Song - YouTube')).toBe('Song');
  });

  it('strips surrounding quotes', () => {
    expect(cleanEmbedTitle('\u201cSong Title\u201d')).toBe('Song Title');
  });

  it('handles multiple metadata suffixes', () => {
    expect(cleanEmbedTitle('Artist - Song (Official Video) (Remastered)')).toBe('Artist - Song');
  });
});

describe('isGarbageTitle', () => {
  it('rejects titles over 80 chars', () => {
    expect(isGarbageTitle('A'.repeat(81))).toBe(true);
  });

  it('rejects titles with 13+ words', () => {
    expect(
      isGarbageTitle('one two three four five six seven eight nine ten eleven twelve thirteen')
    ).toBe(true);
  });

  it('rejects very short titles', () => {
    expect(isGarbageTitle('A')).toBe(true);
  });

  it('rejects GIF descriptions', () => {
    expect(isGarbageTitle('a person dancing in the rain')).toBe(true);
  });

  it('rejects platform names', () => {
    expect(isGarbageTitle('YouTube')).toBe(true);
    expect(isGarbageTitle('Spotify')).toBe(true);
  });

  it('accepts valid titles', () => {
    expect(isGarbageTitle('Never Gonna Give You Up')).toBe(false);
    expect(isGarbageTitle('Bohemian Rhapsody')).toBe(false);
  });
});

describe('parseEmbedTitle', () => {
  it('parses "Artist - Song" format', () => {
    const result = parseEmbedTitle(makeLink('Rick Astley - Never Gonna Give You Up'));
    expect(result).toEqual({
      song: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      canonical: 'Never Gonna Give You Up - Rick Astley',
    });
  });

  it('strips metadata before parsing', () => {
    const result = parseEmbedTitle(makeLink('Kool & The Gang - Celebration (Official Video)'));
    expect(result).toEqual({
      song: 'Celebration',
      artist: 'Kool & The Gang',
      canonical: 'Celebration - Kool & The Gang',
    });
  });

  it('parses "Song by Artist" format', () => {
    const result = parseEmbedTitle(makeLink('Thriller by Michael Jackson on Apple Music'));
    expect(result).toEqual({
      song: 'Thriller',
      artist: 'Michael Jackson',
      canonical: 'Thriller - Michael Jackson',
    });
  });

  it('returns song-only when no artist detected', () => {
    const result = parseEmbedTitle(makeLink('Bohemian Rhapsody'));
    expect(result).toEqual({
      song: 'Bohemian Rhapsody',
      artist: null,
      canonical: 'Bohemian Rhapsody',
    });
  });

  it('returns null for garbage titles', () => {
    expect(parseEmbedTitle(makeLink('a person dancing at a concert very cool video'))).toBeNull();
    expect(parseEmbedTitle(makeLink('X'))).toBeNull();
  });

  it('handles multiple dashes by splitting on first', () => {
    const result = parseEmbedTitle(makeLink('AC/DC - Back In Black - Live'));
    // First dash splits artist/song
    expect(result!.artist).toBe('AC/DC');
    expect(result!.song).toBe('Back In Black - Live');
  });

  it('handles dash at very start gracefully', () => {
    // " - Something" — dash at position 0 means no artist
    const result = parseEmbedTitle(makeLink('Something Good'));
    expect(result!.song).toBe('Something Good');
    expect(result!.artist).toBeNull();
  });

  it('does not split on "by" with lowercase word after', () => {
    // "Song by the roadside" — "the" is lowercase, no artist
    const result = parseEmbedTitle(makeLink('Song by the roadside'));
    expect(result!.artist).toBeNull();
    expect(result!.song).toBe('Song by the roadside');
  });

  it('rejects "Song by Artist" when song part too short', () => {
    // "X by Some Artist" — potentialSong "X" is <2 chars after split
    const result = parseEmbedTitle(makeLink('X by Some Artist'));
    // Falls through; song stays as full cleaned string, no artist split
    expect(result).toBeDefined();
    expect(result!.artist).toBeNull();
  });

  it('returns null when parsed song is garbage', () => {
    // After cleaning, if the song is >80 chars or >12 words, isGarbageTitle returns true
    const longTitle =
      'This Is A Very Long Title That Goes On And On And On And Contains Way Too Many Words To Be Realistic';
    const result = parseEmbedTitle(makeLink(longTitle));
    expect(result).toBeNull();
  });

  it('rejects dash-split when artist part is too short', () => {
    // "X - Something Good" — artist "X" is <2 chars, falls back to full string as song
    const result = parseEmbedTitle(makeLink('X - Something Good'));
    expect(result!.artist).toBeNull();
    expect(result!.song).toBe('X - Something Good');
  });

  it('rejects dash-split when song part is too short', () => {
    // "Some Artist - Y" — song "Y" is <2 chars, falls back to full string as song
    const result = parseEmbedTitle(makeLink('Some Artist - Y'));
    expect(result!.artist).toBeNull();
    expect(result!.song).toBe('Some Artist - Y');
  });
});
