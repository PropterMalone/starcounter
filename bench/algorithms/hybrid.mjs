/**
 * Hybrid algorithm: combines dictionary matching + pattern extraction + context inheritance.
 *
 * Strategy:
 * 1. Dictionary match first (highest precision for known titles)
 * 2. Pattern extraction for titles not in dictionary (quoted text, title case, all caps)
 * 3. Context inheritance for reaction/discussion posts
 * 4. Deduplication: if both dictionary and pattern find the same title, prefer dictionary's canonical form
 */

import { extractTitles } from './baseline-extractor.mjs';
import { findTitlesInText } from './title-dictionary.mjs';

// Reaction patterns (same as context-inheritance)
const REACTION_PATTERNS = [
  /^(yes|yep|yeah|yup|this|same|agreed|exactly|absolutely|definitely|correct|100%|💯)/i,
  /^(so good|great|amazing|incredible|love (it|this)|hell yeah|oh hell yeah)/i,
  /^(came here to say this|this is (it|the one|mine)|good (call|choice|pick|answer))/i,
  /^(underrated|overrated|classic|banger|legendary|goat|peak|chef.s kiss)/i,
  /^[^\w]*$/, // Only emoji/punctuation
  /^(lol|lmao|lmbo|omg|omfg|ha+|😂|🤣|👏|👍|🔥|💯|❤️|🎯|✊|‼️)+$/i,
  /^me too/i,
  /^right\??!*$/i,
  /great movie/i,
  /good movie/i,
];

function isReactionPost(text) {
  const trimmed = (text || '').trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 60) {
    return REACTION_PATTERNS.some((p) => p.test(trimmed));
  }
  return false;
}

/**
 * Run hybrid extraction on all posts.
 * @param {Array} posts - Array of fixture posts
 * @returns {Map<string, string[]>} - Map of URI -> predicted titles
 */
export function run(posts) {
  const postsByUri = new Map();
  for (const post of posts) {
    postsByUri.set(post.uri, post);
  }

  // Phase 1: Extract titles from each post using both strategies
  const explicitTitles = new Map();

  for (const post of posts) {
    let textToSearch = post.fullText || post.text || '';
    if (post.quotedText) textToSearch += '\n' + post.quotedText;

    const dictTitles = findTitlesInText(textToSearch);
    const patternTitles = extractTitles(textToSearch);

    // Merge: dictionary titles take priority, add unique pattern titles
    const merged = new Set(dictTitles);
    for (const pt of patternTitles) {
      // Only add pattern title if it doesn't overlap with any dictionary title
      const ptLower = pt.toLowerCase();
      let isDuplicate = false;
      for (const dt of dictTitles) {
        const dtLower = dt.toLowerCase();
        if (dtLower.includes(ptLower) || ptLower.includes(dtLower)) {
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate) {
        merged.add(pt);
      }
    }

    if (merged.size > 0) {
      explicitTitles.set(post.uri, [...merged]);
    }
  }

  // Phase 2: Context inheritance (two passes for deeper chains)
  const predictions = new Map(explicitTitles);

  for (let pass = 0; pass < 3; pass++) {
    for (const post of posts) {
      if (predictions.has(post.uri)) continue;

      // Try parent inheritance
      if (post.parentUri) {
        const parentTitles = predictions.get(post.parentUri);
        if (parentTitles && parentTitles.length > 0) {
          const text = post.text || '';
          if (isReactionPost(text) || text.length < 80) {
            predictions.set(post.uri, parentTitles);
          }
        }
      }
    }
  }

  return predictions;
}
