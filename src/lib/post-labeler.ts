// pattern: Functional Core
// Phase 2: Label each post against the known dictionary.
//
// Much higher precision than raw extraction because we're matching
// against confirmed titles, not raw regex output.
// Context inheritance for reaction/agreement posts.

import type { PostView } from '../types';
import type { PostTextContent } from './text-extractor';
import type { ThreadDictionary, ValidationLookupEntry, EmbedTitleEntry } from './thread-dictionary';
import { extractCandidates, extractShortTextCandidate, isAgreement } from './thread-dictionary';

type ConsumedRange = { readonly start: number; readonly end: number };

export type LabelPostsOptions = {
  /** Pre-resolved embed titles: postUri → parsed embed title */
  readonly embedTitles?: ReadonlyMap<string, EmbedTitleEntry>;
};

/**
 * Label each post with the titles it mentions.
 *
 * @param posts All posts (index 0 = root)
 * @param postTexts Pre-extracted text content per post URI
 * @param dictionary The thread dictionary from Phase 1
 * @param lookup Validation lookup (lowercase candidate → canonical)
 * @param rootUri Root post URI
 * @param rootText Lowercase root post text
 * @param options Optional config (embed titles for direct assignment)
 * @returns Map from post URI → Set of canonical titles mentioned
 */
export function labelPosts(
  posts: readonly PostView[],
  postTexts: ReadonlyMap<string, PostTextContent>,
  dictionary: ThreadDictionary,
  lookup: ReadonlyMap<string, ValidationLookupEntry>,
  rootUri: string,
  rootText: string,
  options?: LabelPostsOptions
): Map<string, Set<string>> {
  // Use patched lookup (with merge redirects) if available, otherwise original
  const effectiveLookup = dictionary.patchedLookup ?? lookup;
  const lowerRootText = rootText.toLowerCase();
  const postsByUri = new Map<string, PostView>();
  for (const p of posts) postsByUri.set(p.uri, p);

  // Build efficient matching structures from dictionary
  // Sort by alias length descending (match longest first)
  type Matcher = { canonical: string; patterns: string[] };
  const matchers: Matcher[] = [];
  for (const [canonical, info] of dictionary.entries) {
    const patterns = [...info.aliases].sort((a, b) => b.length - a.length);
    matchers.push({ canonical, patterns });
  }
  matchers.sort((a, b) => b.patterns[0]!.length - a.patterns[0]!.length);

  const predictions = new Map<string, Set<string>>();

  // Pass 1: Direct matching
  for (const post of posts) {
    if (post.uri === rootUri) continue;

    const textContent = postTexts.get(post.uri);
    if (!textContent) continue;

    // Build search text, excluding quoted text from root
    let searchText = textContent.ownText;
    if (textContent.quotedText && textContent.quotedUri !== rootUri) {
      searchText += '\n' + textContent.quotedText;
    }
    if (textContent.quotedAltText) {
      searchText += '\n' + textContent.quotedAltText.join('\n');
    }

    const validTitles = new Set<string>();

    // Embed title direct assignment: if this post has a resolved embed link,
    // assign its parsed title immediately (highest confidence, no regex needed)
    const embedEntry = options?.embedTitles?.get(post.uri);
    if (embedEntry && dictionary.entries.has(embedEntry.canonical)) {
      validTitles.add(embedEntry.canonical);
    }

    // Strategy A: Forward lookup with longest-match-wins
    const candidates = extractCandidates(searchText);
    const shortCandidate = extractShortTextCandidate(post.record.text);
    if (shortCandidate) candidates.push(shortCandidate);

    candidates.sort((a, b) => b.length - a.length);
    const consumedCandidates: string[] = [];

    for (const candidate of candidates) {
      const candidateLower = candidate.toLowerCase();
      if (consumedCandidates.some((longer) => longer.includes(candidateLower))) continue;

      const entry = effectiveLookup.get(candidateLower);
      if (entry && dictionary.entries.has(entry.canonical)) {
        validTitles.add(entry.canonical);
        consumedCandidates.push(candidateLower);
      }
    }

    // Strategy B: Reverse lookup with longest-match-wins (character spans)
    const lowerText = searchText.toLowerCase();
    const consumedRanges: ConsumedRange[] = [];

    for (const { canonical, patterns } of matchers) {
      if (validTitles.has(canonical)) continue;
      for (const pattern of patterns) {
        if (lowerRootText.includes(pattern)) continue;
        const idx = lowerText.indexOf(pattern);
        if (idx === -1) continue;

        const start = idx;
        const end = idx + pattern.length;
        const overlaps = consumedRanges.some((r) => start < r.end && end > r.start);
        if (overlaps) continue;

        validTitles.add(canonical);
        consumedRanges.push({ start, end });
        break;
      }
    }

    if (validTitles.size > 0) {
      predictions.set(post.uri, validTitles);
    }
  }

  // Pass 2: Context inheritance (depth-limited)
  const MAX_INHERIT_DEPTH = 2;

  function getInheritedTitles(uri: string, depth: number): Set<string> | null {
    if (depth > MAX_INHERIT_DEPTH) return null;
    const existing = predictions.get(uri);
    if (existing) return existing;
    const post = postsByUri.get(uri);
    if (!post) return null;
    const parentUri = post.record.reply?.parent.uri;
    if (!parentUri) return null;
    return getInheritedTitles(parentUri, depth + 1);
  }

  for (const post of posts) {
    if (predictions.has(post.uri)) continue;
    if (post.uri === rootUri) continue;

    // Only inherit for explicit agreement/endorsement (not surprise or amusement).
    // isReaction is broad (catches "whoa", "lol", emojis) for candidate extraction;
    // isAgreement is strict (only "yes", "same", "agreed", etc.) for inheritance.
    if (!isAgreement(post.record.text)) continue;

    const parentUri = post.record.reply?.parent.uri;
    if (parentUri) {
      const inherited = getInheritedTitles(parentUri, 1);
      if (inherited && inherited.size > 0) {
        predictions.set(post.uri, new Set(inherited));
      }
    }
  }

  return predictions;
}
