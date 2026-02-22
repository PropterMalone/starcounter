/**
 * Context Inheritance algorithm:
 * If a post doesn't explicitly name a movie, inherit the topic from its parent.
 *
 * This handles the common pattern:
 *   Post A: "The Hunt for Red October"
 *   Post B (reply to A): "SO GOOD, one of my favorites"
 *   Post C (reply to B): "The submarine scenes are incredible"
 *
 * Posts B and C are about HFRO even though they don't name it.
 *
 * Also handles quote tweets: if a QT quotes a post about a movie
 * and doesn't introduce a new one, it's about the quoted movie.
 */

import { extractTitles } from './baseline-extractor.mjs';

// Reaction patterns that indicate agreement/discussion without new topic
const REACTION_PATTERNS = [
  /^(yes|yep|yeah|yup|this|same|agreed|exactly|absolutely|definitely|correct|100%|💯)/i,
  /^(so good|great|amazing|incredible|love (it|this)|hell yeah|oh hell yeah)/i,
  /^(came here to say this|this is (it|the one|mine)|good (call|choice|pick|answer))/i,
  /^(underrated|overrated|classic|banger|legendary|goat|peak|chef.s kiss)/i,
  /^[^\w]*$/,  // Only emoji/punctuation
  /^(lol|lmao|lmbo|omg|omfg|ha+|😂|🤣|👏|👍|🔥|💯|❤️|🎯|✊|‼️)+$/i,
  /^me too/i,
  /^right\??!*$/i,
];

function isReactionPost(text) {
  const trimmed = (text || '').trim();
  if (trimmed.length === 0) return true; // Empty post
  if (trimmed.length < 50) {
    return REACTION_PATTERNS.some((p) => p.test(trimmed));
  }
  return false;
}

/**
 * Run context-inheritance extraction on all posts.
 * @param {Array} posts - Array of fixture posts
 * @returns {Map<string, string[]>} - Map of URI -> predicted titles
 */
export function run(posts) {
  // Phase 1: Build lookup maps
  const postsByUri = new Map();
  for (const post of posts) {
    postsByUri.set(post.uri, post);
  }

  // Phase 2: Explicit title extraction (same as baseline)
  const explicitTitles = new Map();
  for (const post of posts) {
    let textToSearch = post.fullText || post.text || '';
    if (post.quotedText) textToSearch += '\n' + post.quotedText;
    const titles = extractTitles(textToSearch);
    if (titles.length > 0) {
      explicitTitles.set(post.uri, titles);
    }
  }

  // Phase 3: Context inheritance
  const predictions = new Map();

  for (const post of posts) {
    // If we have explicit titles, use them
    if (explicitTitles.has(post.uri)) {
      predictions.set(post.uri, explicitTitles.get(post.uri));
      continue;
    }

    // Try to inherit from parent
    if (post.parentUri) {
      const parentTitles = explicitTitles.get(post.parentUri) || predictions.get(post.parentUri);
      if (parentTitles && parentTitles.length > 0) {
        const text = post.text || '';
        // Only inherit if this looks like a reaction/discussion post, not a new topic
        if (isReactionPost(text) || text.length < 100) {
          predictions.set(post.uri, parentTitles);
        }
      }
    }

    // Try to inherit from quoted post
    if (!predictions.has(post.uri) && post.quotedText) {
      // The quoted text might reference a movie; check if parent of the QT chain has titles
      // For QTs, the "parent" is conceptually the quoted post
      // We already checked quotedText in explicit extraction, so this is a fallback
    }
  }

  return predictions;
}
