// pattern: Functional Core
// Parse song/artist from resolved embed titles (YouTube, Spotify, Apple Music, etc.)
//
// Ported from bench/algorithms/music-extractor.mjs with TypeScript types.
// Handles: YouTube metadata stripping, "Artist - Song" parsing,
// "Song by Artist" parsing, garbage title filtering.

import type { EmbedLink } from './text-extractor';

export type ParsedEmbedTitle = {
  readonly song: string;
  readonly artist: string | null;
  /** "Song - Artist" or just "Song" (matches gold label format) */
  readonly canonical: string;
};

// ---------------------------------------------------------------------------
// YouTube/Spotify/Apple Music metadata stripping
// ---------------------------------------------------------------------------

/** Strip platform metadata suffixes from video/track titles. */
export function cleanEmbedTitle(title: string): string {
  return (
    title
      // Parenthetical video metadata (preserve year parentheticals like "(1978)")
      .replace(
        /\s*\((Official\s*(Music\s*)?Video|Official\s*Audio|Audio|Lyric\s*Video|Lyrics?|Visualizer|Performance\s*Video|Full\s*Album|Animated\s*Video|Music\s*Video|Live|Acoustic|Remix|Remaster(ed)?|Explicit|Clean|Radio\s*Edit)\)/gi,
        ''
      )
      .replace(
        /\s*\[(Official\s*(Music\s*)?Video|Official\s*Audio|Audio|Lyric\s*Video|Lyrics?|Visualizer|Live|Acoustic|Remix)\]/gi,
        ''
      )
      // Trailing metadata markers
      .replace(/\s*[/]{1,2}\s*Lyrics?$/i, '')
      .replace(/\s*-\s*Lyrics?$/i, '')
      // Remaster metadata
      .replace(/\s*\(\d+p\s+Remaster[^)]*\)/gi, '')
      .replace(/\s*\(Remastered(\s*\d*)?\)/gi, '')
      .replace(/\s*\[Remastered(\s*\d*)?\]/gi, '')
      // Apple Music suffixes
      .replace(/\s+on\s+Apple\s+Music$/i, '')
      // Spotify "- song by Artist on Spotify" trailing format
      .replace(/\s+on\s+Spotify$/i, '')
      // YouTube Music trailing format
      .replace(/\s+-\s+YouTube$/i, '')
      .replace(/\s+-\s+YouTube\s+Music$/i, '')
      // Surrounding quotes
      .replace(/^["""\u201c\u201d]+|["""\u201c\u201d]+$/g, '')
      .trim()
  );
}

// ---------------------------------------------------------------------------
// Garbage title filtering
// ---------------------------------------------------------------------------

/** Reject entries that are clearly not real song/media titles. */
export function isGarbageTitle(title: string): boolean {
  if (title.length > 80) return true;
  if (title.split(/\s+/).length > 12) return true;
  if (title.length < 2) return true;
  // GIF/image descriptions
  if (/^a\s+(person|man|woman|group|cat|dog|gif|clip)/i.test(title)) return true;
  // Generic website titles
  if (/^(youtube|spotify|apple\s+music|soundcloud|bandcamp)$/i.test(title)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Title → Song + Artist parsing
// ---------------------------------------------------------------------------

/**
 * Parse a cleaned embed title into song and artist components.
 *
 * Formats handled:
 * - "Artist - Song" (most YouTube titles)
 * - "Artist - Song (metadata)" (after cleaning)
 * - "Song by Artist" (Apple Music, lyrics sites)
 * - "Song" (no artist detected)
 */
export function parseEmbedTitle(link: EmbedLink): ParsedEmbedTitle | null {
  const cleaned = cleanEmbedTitle(link.title);
  if (isGarbageTitle(cleaned)) return null;

  let song: string;
  let artist: string | null = null;

  // Try "Artist - Song" split (most YouTube titles use " - " separator)
  const dashIdx = cleaned.indexOf(' - ');
  if (dashIdx > 0 && dashIdx < cleaned.length - 3) {
    artist = cleaned.substring(0, dashIdx).trim();
    song = cleaned.substring(dashIdx + 3).trim();

    // Reject if either part is too short or looks like metadata
    if (artist.length < 2 || song.length < 2) {
      song = cleaned;
      artist = null;
    }
  } else {
    song = cleaned;
  }

  // Try "Song by Artist" format (common for Apple Music, lyrics sites)
  if (!artist && song.includes(' by ')) {
    const byMatch = song.match(/^(.+?)\s+by\s+([A-Z].{2,})$/);
    if (byMatch) {
      const potentialSong = byMatch[1]!
        .replace(/^["""\u201c\u201d]+|["""\u201c\u201d]+$/g, '')
        .trim();
      const potentialArtist = byMatch[2]!.replace(/\s+on\s+Apple\s+Music$/i, '').trim();
      if (potentialSong.length >= 2 && potentialArtist.length >= 2) {
        song = potentialSong;
        artist = potentialArtist;
      }
    }
  }

  // Clean artist of trailing platform names
  if (artist) {
    artist = artist.replace(/\s+on\s+Apple\s+Music$/i, '').trim();
  }

  // Final garbage check on parsed song
  if (isGarbageTitle(song)) return null;

  const canonical = artist ? `${song} - ${artist}` : song;
  return { song, artist, canonical };
}
