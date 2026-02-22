#!/usr/bin/env node
/**
 * Gold-standard labeler for the letterboxd (Muppet movies) benchmark fixture.
 *
 * Much simpler than the dad-movies labeler since there are only ~10 Muppet movies
 * and 48 posts. Uses dictionary matching + context inheritance.
 *
 * Usage: node bench/gold-labeler-letterboxd.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'letterboxd.json');
const OUTPUT_DIR = join(__dirname, 'labels');
const OUTPUT_PATH = join(OUTPUT_DIR, 'letterboxd-gold.json');

// ---------------------------------------------------------------------------
// Title dictionary
// ---------------------------------------------------------------------------

const TITLE_PATTERNS = new Map([
  [
    'The Muppet Movie',
    [
      'the muppet movie',
      'muppet movie',
      'the first one',
      'the original',
      'rainbow connection',
    ],
  ],
  [
    'The Great Muppet Caper',
    ['the great muppet caper', 'great muppet caper', 'muppet caper', 'caper'],
  ],
  [
    'The Muppets Take Manhattan',
    ['the muppets take manhattan', 'muppets take manhattan', 'take manhattan', 'manhattan'],
  ],
  [
    'The Muppet Christmas Carol',
    [
      'the muppet christmas carol',
      'muppet christmas carol',
      'muppets christmas carol',
      'christmas carol',
    ],
  ],
  [
    'Muppet Treasure Island',
    ['muppet treasure island', 'treasure island'],
  ],
  [
    'Muppets from Space',
    ['muppets from space', 'from space'],
  ],
  [
    'The Muppets',
    ['the muppets (2011)', 'the muppets 2011', 'the muppets'],
  ],
  [
    'Muppets Most Wanted',
    ['muppets most wanted', 'most wanted'],
  ],
  [
    "Emmet Otter's Jug-Band Christmas",
    ["emmet otter's jug-band christmas", 'emmet otter', "emmet otter's"],
  ],
]);

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findTitles(text) {
  if (!text || text.trim().length === 0) return [];
  const lower = text.toLowerCase();
  const found = new Set();

  for (const [canonical, patterns] of TITLE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.length <= 5) {
        const regex = new RegExp(`\\b${escapeRegex(pattern)}\\b`, 'i');
        if (regex.test(lower)) {
          found.add(canonical);
          break;
        }
      } else {
        if (lower.includes(pattern)) {
          found.add(canonical);
          break;
        }
      }
    }
  }

  return [...found];
}

// Disambiguate: "The Muppets" (2011) vs. generic "the muppets"
// Only count "The Muppets" as the 2011 movie if text explicitly says 2011 or THE MUPPETS
function refineTitles(titles, text) {
  const lower = (text || '').toLowerCase();
  const result = [...titles];

  // If "The Muppets" matched but text doesn't say "2011" or use it as a specific title
  // it's probably generic. Remove unless clearly specific.
  const idx = result.indexOf('The Muppets');
  if (idx !== -1) {
    const is2011 = lower.includes('2011') || lower.includes('the muppets (') || /\bthe muppets\b[^a-z]/.test(lower);
    if (!is2011 && result.length > 1) {
      // If there are other specific titles, the generic "the muppets" is probably not the 2011 film
      result.splice(idx, 1);
    }
  }

  return result;
}

// Reaction detection
const REACTION_PATTERNS = [
  /^(yes|yep|yeah|agreed|exactly|this|same|🎶|well, yes)[\s!.\u2026]*$/i,
  /^.{0,3}$/,
  /^[\s!?\u{1F44D}\u{1F44F}\u{1F525}\u{1F60D}\u{1F64F}\u{2764}]+$/u,
];

function isReaction(text) {
  const trimmed = (text || '').trim();
  if (trimmed.length === 0) return true;
  for (const p of REACTION_PATTERNS) {
    if (p.test(trimmed)) return true;
  }
  if (trimmed.length <= 15 && !/[A-Z][a-z]{2,}/.test(trimmed)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('Reading fixture...');
  const data = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  const posts = data.posts;
  console.log(`Loaded ${posts.length} posts.`);

  const postByUri = new Map();
  for (const p of posts) postByUri.set(p.uri, p);

  const rootUri = posts[0].uri;
  const labels = new Map();

  // Pass 1: Explicit detection
  for (const post of posts) {
    if (post.uri === rootUri) {
      labels.set(post.uri, { topics: [], onTopic: false, confidence: 'high', note: 'Root prompt' });
      continue;
    }

    const searchText = [
      post.fullText || post.text || '',
      post.quotedText || '',
      ...(post.quotedAltText || []),
    ].join('\n');

    const ownText = post.fullText || post.text || '';
    let titles = findTitles(ownText);
    titles = refineTitles(titles, ownText);

    // Check quoted/alt text too
    if (titles.length === 0 && post.quotedText) {
      const quotedTitles = findTitles(post.quotedText);
      // Don't inherit from quoted text (it's the root prompt for all QTs)
    }

    // Check image alt text
    if (post.fullText && post.text) {
      const altText = post.fullText.substring(post.text.length);
      if (altText.trim()) {
        const altTitles = findTitles(altText);
        titles = [...new Set([...titles, ...altTitles])];
      }
    }

    if (titles.length > 0) {
      labels.set(post.uri, { topics: titles, onTopic: true, confidence: 'high' });
    }
  }

  // Pass 2: Manual labels for tricky posts (small enough to hand-label)
  for (const post of posts) {
    if (labels.has(post.uri)) continue;
    const text = (post.text || '').toLowerCase();
    const handle = post.author?.handle || '';

    // Posts with images only (no text) - check if they're muppet movie screenshots
    if (post.hasImages && (!post.text || post.text.trim().length === 0)) {
      // Image-only posts in reply to a muppet movie prompt are likely showing their answer
      // We'd need to see the images to know which movie - mark as on-topic but unknown title
      labels.set(post.uri, {
        topics: [],
        onTopic: true,
        confidence: 'low',
        note: 'Image-only reply, likely shows a specific movie',
      });
      continue;
    }

    // "this one" / "Always the first one" patterns - inherit from parent or context
    if (
      /\b(this one|the first one|always the first|the original|it was perfect)\b/i.test(text) &&
      post.parentUri
    ) {
      const parent = postByUri.get(post.parentUri);
      const parentLabel = labels.get(post.parentUri);
      if (parentLabel && parentLabel.topics.length > 0) {
        labels.set(post.uri, {
          topics: parentLabel.topics,
          onTopic: true,
          confidence: 'medium',
          note: 'References parent topic',
        });
        continue;
      }
    }

    // Context: if replying to a post about a specific movie and it's a short reply
    if (post.parentUri) {
      const parentLabel = labels.get(post.parentUri);
      if (parentLabel && parentLabel.topics.length > 0 && isReaction(post.text)) {
        labels.set(post.uri, {
          topics: parentLabel.topics,
          onTopic: true,
          confidence: 'medium',
          note: 'Reaction to parent',
        });
        continue;
      }
    }
  }

  // Pass 3: Label remaining
  for (const post of posts) {
    if (labels.has(post.uri)) continue;
    const text = (post.text || '').trim();

    // Short generic replies that don't name a movie
    if (text.length === 0) {
      labels.set(post.uri, {
        topics: [],
        onTopic: false,
        confidence: 'low',
        note: 'Empty post',
      });
    } else if (text.length < 200 && /muppet|movie|film/i.test(text)) {
      labels.set(post.uri, {
        topics: [],
        onTopic: true,
        confidence: 'low',
        note: 'Discusses muppet movies without naming one',
      });
    } else {
      labels.set(post.uri, {
        topics: [],
        onTopic: true,
        confidence: 'low',
        note: 'On-topic reply but title not recognized',
      });
    }
  }

  // Stats
  const onTopicCount = [...labels.values()].filter((l) => l.onTopic).length;
  const allTitles = new Set();
  for (const l of labels.values()) for (const t of l.topics) allTitles.add(t);

  const confidenceCounts = { high: 0, medium: 0, low: 0 };
  for (const l of labels.values()) confidenceCounts[l.confidence]++;

  const titleCounts = {};
  for (const l of labels.values()) for (const t of l.topics) titleCounts[t] = (titleCounts[t] || 0) + 1;
  const sortedTitles = Object.entries(titleCounts).sort((a, b) => b[1] - a[1]);

  // Output
  const labelEntries = {};
  for (const [uri, label] of labels) labelEntries[uri] = label;

  const output = {
    meta: {
      labeledAt: new Date().toISOString(),
      labeledBy: 'claude-opus-4-6',
      fixtureFile: 'letterboxd.json',
      postCount: posts.length,
      labeledCount: labels.size,
      onTopicCount,
      offTopicCount: labels.size - onTopicCount,
      uniqueTitles: allTitles.size,
      confidence: confidenceCounts,
    },
    labels: labelEntries,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);

  console.log('\n' + '='.repeat(70));
  console.log('GOLD LABELING STATISTICS');
  console.log('='.repeat(70));
  console.log(`  Total posts:       ${posts.length}`);
  console.log(`  On-topic:          ${onTopicCount}`);
  console.log(`  Off-topic:         ${labels.size - onTopicCount}`);
  console.log(`  Unique titles:     ${allTitles.size}`);
  console.log(`  Confidence:        high=${confidenceCounts.high}  medium=${confidenceCounts.medium}  low=${confidenceCounts.low}`);

  console.log('\nTitle counts:');
  sortedTitles.forEach(([t, c]) => console.log(`  ${t.padEnd(45)} ${c}`));
}

main();
