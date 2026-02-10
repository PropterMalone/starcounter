/**
 * URL title resolver for the blast-songs benchmark fixture.
 *
 * Resolves song/artist metadata from URLs embedded in posts:
 *   1. Extract embed titles from blast-songs-raw.json (thread posts with link previews)
 *   2. Resolve remaining YouTube URLs via the oEmbed API
 *   3. Hardcode Spotify/Apple Music entries (no public oEmbed)
 *
 * Output: bench/fixtures/blast-songs-url-titles.json
 *
 * Usage:  node bench/resolve-blast-songs-urls.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'blast-songs.json');
const RAW_FIXTURE_PATH = join(__dirname, 'fixtures', 'blast-songs-raw.json');
const OUTPUT_PATH = join(__dirname, 'fixtures', 'blast-songs-url-titles.json');

const OEMBED_DELAY_MS = 100;

// ---------------------------------------------------------------------------
// 1. YouTube title parsing
// ---------------------------------------------------------------------------

/**
 * Strip common video title suffixes that add noise to song/artist extraction.
 */
function cleanVideoTitle(title) {
  return title
    .replace(/\s*\((?:Official\s+)?(?:Music\s+)?Video\)/gi, '')
    .replace(/\s*\(Official\s+Audio\)/gi, '')
    .replace(/\s*\(Audio\)/gi, '')
    .replace(/\s*\(Lyric\s+Video\)/gi, '')
    .replace(/\s*\(Lyrics?\)/gi, '')
    .replace(/\s*\(Official\s+Lyric\s+Video\)/gi, '')
    .replace(/\s*\(Official\s+Visualizer\)/gi, '')
    .replace(/\s*\(Visualizer\)/gi, '')
    .replace(/\s*\(Live[^)]*\)/gi, '')
    .replace(/\s*\(Remastered[^)]*\)/gi, '')
    .replace(/\s*\(HD\)/gi, '')
    .replace(/\s*\(HQ\)/gi, '')
    .replace(/\s*\[Official\s+(?:Music\s+)?Video\]/gi, '')
    .replace(/\s*\[Official\s+Audio\]/gi, '')
    .replace(/\s*\[Audio\]/gi, '')
    .replace(/\s*\[Lyric\s+Video\]/gi, '')
    .replace(/\s*\[Lyrics?\]/gi, '')
    .replace(/\s*\[HD\]/gi, '')
    .replace(/\s*\[HQ\]/gi, '')
    .replace(/\s*\[Remastered[^\]]*\]/gi, '')
    .replace(/\s*\(feat\.[^)]*\)/gi, '')
    .replace(/\s*ft\.\s*.+$/i, '')
    .trim();
}

/**
 * Parse "Artist - Song" or "Song - Artist" from a cleaned YouTube title.
 * Returns { song, artist } or null if unparseable.
 */
function parseArtistSong(cleaned) {
  // Most YouTube titles use " - " as separator
  const dashMatch = cleaned.match(/^(.+?)\s+-\s+(.+)$/);
  if (dashMatch) {
    return { artist: dashMatch[1].trim(), song: dashMatch[2].trim() };
  }

  // Some use " | " or " ~ "
  const altMatch = cleaned.match(/^(.+?)\s+[|~]\s+(.+)$/);
  if (altMatch) {
    return { artist: altMatch[1].trim(), song: altMatch[2].trim() };
  }

  // Some use ": " (like "Artist: Song Title")
  const colonMatch = cleaned.match(/^(.+?):\s+(.+)$/);
  if (colonMatch) {
    return { artist: colonMatch[1].trim(), song: colonMatch[2].trim() };
  }

  // Quoted song in title: Artist "Song"
  const quotedMatch = cleaned.match(/^(.+?)\s+["""](.+?)["""]$/);
  if (quotedMatch) {
    return { artist: quotedMatch[1].trim(), song: quotedMatch[2].trim() };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 2. YouTube ID extraction
// ---------------------------------------------------------------------------

const YT_ID_REGEX =
  /(?:youtu\.be\/|youtube\.com\/watch\?v=|m\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/;

function extractYouTubeId(text) {
  const match = text.match(YT_ID_REGEX);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// 3. Embed extraction from raw fixture
// ---------------------------------------------------------------------------

function extractRawEmbeds(rawData) {
  const results = new Map();

  function walk(node) {
    if (node == null || node.post == null) return;
    const post = node.post;

    let title = null;
    let url = null;

    if (post.embed?.external?.title) {
      title = post.embed.external.title;
      url = post.embed.external.uri;
    } else if (post.embed?.media?.external?.title) {
      title = post.embed.media.external.title;
      url = post.embed.media.external.uri;
    }

    if (title && url) {
      const cleaned = cleanVideoTitle(title);
      const parsed = parseArtistSong(cleaned);

      let platform = 'unknown';
      if (/youtu/i.test(url)) platform = 'youtube';
      else if (/spotify/i.test(url)) platform = 'spotify';
      else if (/music\.apple/i.test(url)) platform = 'apple';
      else if (/soundcloud/i.test(url)) platform = 'soundcloud';
      else if (/bandcamp/i.test(url)) platform = 'bandcamp';

      results.set(post.uri, {
        url,
        platform,
        videoTitle: title,
        parsedSong: parsed?.song || cleaned,
        parsedArtist: parsed?.artist || null,
      });
    }

    if (node.replies) {
      for (const r of node.replies) walk(r);
    }
  }

  walk(rawData.thread);
  return results;
}

// ---------------------------------------------------------------------------
// 4. YouTube oEmbed resolver
// ---------------------------------------------------------------------------

async function resolveYouTubeTitle(videoId) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  const res = await fetch(url);
  if (!res.ok) {
    return null;
  }
  const data = await res.json();
  return data.title || null;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// 5. Spotify / Apple Music manual entries
// ---------------------------------------------------------------------------

/**
 * Manual entries for Spotify/Apple Music links that lack oEmbed.
 * Keyed by a substring of the URL or the post URI.
 */
const MANUAL_ENTRIES = new Map([
  // Spotify tracks identified from post text context
  ['open.spotify.com/track/1Y2ExJ', { song: 'Celebration', artist: 'Kool & the Gang' }],
  ['open.spotify.com/track/6tYSqt', { song: 'FDT', artist: 'YG' }],
  ['open.spotify.com/playlist/', null], // Playlists — not a single song
  ['music.apple.com/us/playlist/', null], // Playlists
]);

// ---------------------------------------------------------------------------
// 6. Main resolver
// ---------------------------------------------------------------------------

async function main() {
  console.log('Loading fixtures...');
  const data = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  const rawData = JSON.parse(readFileSync(RAW_FIXTURE_PATH, 'utf8'));
  const posts = data.posts;
  console.log(`  ${posts.length} posts loaded.`);

  // Step 1: Extract embed titles from raw fixture
  console.log('\nStep 1: Extracting embed titles from raw fixture...');
  const embedTitles = extractRawEmbeds(rawData);
  console.log(`  Found ${embedTitles.size} posts with embed titles.`);

  // Step 2: Find YouTube URLs that need oEmbed resolution
  console.log('\nStep 2: Finding YouTube URLs needing oEmbed...');
  const needsResolution = new Map(); // videoId -> [post URIs]

  for (const post of posts) {
    if (embedTitles.has(post.uri)) continue;

    const allText = (post.fullText || post.text || '') + ' ' + (post.quotedText || '');
    const videoId = extractYouTubeId(allText);
    if (!videoId) continue;

    if (!needsResolution.has(videoId)) {
      needsResolution.set(videoId, []);
    }
    needsResolution.get(videoId).push(post.uri);
  }
  console.log(`  ${needsResolution.size} unique YouTube videos to resolve.`);

  // Step 3: Resolve via oEmbed
  console.log(`\nStep 3: Resolving YouTube titles via oEmbed (~${Math.ceil(needsResolution.size * OEMBED_DELAY_MS / 1000)}s)...`);
  const oembedResults = new Map(); // videoId -> title
  let resolved = 0;
  let failed = 0;

  for (const [videoId, postUris] of needsResolution) {
    const title = await resolveYouTubeTitle(videoId);
    if (title) {
      oembedResults.set(videoId, title);
      resolved++;
    } else {
      failed++;
    }

    if ((resolved + failed) % 50 === 0) {
      console.log(`  Progress: ${resolved + failed}/${needsResolution.size} (${resolved} resolved, ${failed} failed)`);
    }
    await sleep(OEMBED_DELAY_MS);
  }
  console.log(`  Resolved: ${resolved}, Failed: ${failed}`);

  // Step 4: Build combined output
  console.log('\nStep 4: Building output...');
  const titles = {};

  // Add embed titles
  for (const [uri, entry] of embedTitles) {
    titles[uri] = entry;
  }

  // Add oEmbed results
  for (const post of posts) {
    if (titles[post.uri]) continue;

    const allText = (post.fullText || post.text || '') + ' ' + (post.quotedText || '');
    const videoId = extractYouTubeId(allText);
    if (!videoId || !oembedResults.has(videoId)) continue;

    const rawTitle = oembedResults.get(videoId);
    const cleaned = cleanVideoTitle(rawTitle);
    const parsed = parseArtistSong(cleaned);
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    titles[post.uri] = {
      url,
      platform: 'youtube',
      videoTitle: rawTitle,
      parsedSong: parsed?.song || cleaned,
      parsedArtist: parsed?.artist || null,
    };
  }

  const output = {
    resolvedAt: new Date().toISOString(),
    stats: {
      fromEmbeds: embedTitles.size,
      fromOembed: resolved,
      oembedFailed: failed,
      totalResolved: Object.keys(titles).length,
    },
    titles,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${OUTPUT_PATH}`);
  console.log(`  Total resolved: ${Object.keys(titles).length} posts`);

  // Quick stats
  const platforms = {};
  for (const entry of Object.values(titles)) {
    platforms[entry.platform] = (platforms[entry.platform] || 0) + 1;
  }
  console.log('  By platform:', JSON.stringify(platforms));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
