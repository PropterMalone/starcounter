// pattern: Imperative Shell
// Headless analysis pipeline: fetches a thread and tallies media mentions.
//
// Used by both the web app (via StarcounterApp) and the Cloudflare Worker bot.
// No DOM dependencies — only uses Web APIs (fetch, URL, etc.).

import type { BlueskyClient } from '../api/bluesky-client';
import { ThreadBuilder } from './thread-builder';
import type { PostView } from '../types';
import type { MentionCount } from '../types';
import type { PostTextContent, EmbedLink } from './text-extractor';
import type { EmbedTitleEntry, ValidationLookupEntry } from './thread-dictionary';
import { extractPostText } from './text-extractor';
import { extractCandidates, extractShortTextCandidate } from './thread-dictionary';
import { parseEmbedTitle } from './embed-title-parser';
import { resolveEmbedTitles } from './oembed-client';
import { buildValidationLookup, discoverDictionary } from './thread-dictionary';
import { buildSelfValidatedLookup, buildListValidatedLookup } from './self-validation';
import { labelPosts } from './post-labeler';
import { fetchThreadPosts } from './thread-fetcher';
import type { FetchProgress } from './thread-fetcher';
import type { MediaMention } from './mention-extractor';
import { ValidationClient } from './validation-client';

export type AnalysisConfig = {
  /** Base URL for the validation API endpoint (e.g. '/api/validate'). Empty/omitted = skip API validation. */
  readonly validationApiUrl?: string;
  /** Base URL for the oEmbed API endpoint (e.g. '/api/oembed'). Empty/omitted = skip oEmbed resolution. */
  readonly oembedApiUrl?: string;
  /** Selected media types for API validation (e.g. ['movie', 'tv']). Empty = self-validation. */
  readonly mediaTypes?: readonly string[];
  /** User-provided validation list. Non-empty = list-validation. */
  readonly customList?: readonly string[];
  /** Progress callback for each stage. */
  readonly onProgress?: (stage: string, detail: string) => void;
  /** Progress callback for fetch stage (pass-through to thread-fetcher). */
  readonly onFetchProgress?: (progress: FetchProgress) => void;
};

export type AnalysisResult = {
  readonly mentionCounts: MentionCount[];
  readonly uncategorizedPosts: PostView[];
  readonly postCount: number;
  readonly rootPost: PostView;
};

/**
 * Run the full analysis pipeline on a Bluesky thread.
 *
 * @param atUri - AT-URI of the root post (e.g. at://did:plc:xxx/app.bsky.feed.post/xxx)
 * @param client - Authenticated or public BlueskyClient instance
 * @param config - Pipeline configuration (validation mode, progress callbacks)
 * @returns Analysis results with mention counts and uncategorized posts
 */
export async function analyzeThread(
  atUri: string,
  client: BlueskyClient,
  config: AnalysisConfig = {}
): Promise<AnalysisResult> {
  const threadBuilder = new ThreadBuilder();
  const mediaTypes = config.mediaTypes ?? [];
  const customList = config.customList ?? [];

  // --- Shared state for incremental extraction during fetch ---
  const postTexts = new Map<string, PostTextContent>();
  const uniqueCandidates = new Set<string>();
  const postEmbedLinks = new Map<string, EmbedLink[]>();
  let rootAtUri = '';
  let rootTextLower = '';

  const processPostsBatch = (posts: readonly PostView[]) => {
    for (const post of posts) {
      if (postTexts.has(post.uri)) continue;
      const textContent = extractPostText(post);
      postTexts.set(post.uri, textContent);

      if (textContent.embedLinks.length > 0) {
        postEmbedLinks.set(post.uri, [...textContent.embedLinks]);
      }

      // First post processed becomes root
      if (rootAtUri === '') {
        rootAtUri = post.uri;
        rootTextLower = post.record.text.toLowerCase();
        continue; // Skip root for candidate extraction
      }

      // Extract candidates incrementally
      let searchText = textContent.ownText;
      if (textContent.quotedText && textContent.quotedUri !== rootAtUri) {
        searchText += '\n' + textContent.quotedText;
      }
      if (textContent.quotedAltText) {
        searchText += '\n' + textContent.quotedAltText.join('\n');
      }

      for (const c of extractCandidates(searchText)) {
        uniqueCandidates.add(c);
      }
      const shortCandidate = extractShortTextCandidate(post.record.text);
      if (shortCandidate) uniqueCandidates.add(shortCandidate);
    }
  };

  // --- Stage 1: Fetch all posts ---
  config.onProgress?.('fetching', 'starting');
  const fetchResult = await fetchThreadPosts(atUri, client, threadBuilder, {
    onPostsBatch: processPostsBatch,
    onProgress: config.onFetchProgress,
  });

  const allPosts = fetchResult.allPosts;
  const rootPost = allPosts[0];
  if (!rootPost) {
    throw new Error('no posts found in thread');
  }

  // --- Stage 2: Embed title resolution ---
  config.onProgress?.('embeds', `${postEmbedLinks.size} posts with embed links`);
  const embedTitles = new Map<string, EmbedTitleEntry>();
  const youtubeUrlsToResolve = new Map<string, string>();

  for (const [postUri, links] of postEmbedLinks) {
    if (postUri === rootAtUri) continue;
    for (const link of links) {
      const parsed = parseEmbedTitle(link);
      if (parsed) {
        embedTitles.set(postUri, { canonical: parsed.canonical, song: parsed.song });
      } else if (link.platform === 'youtube' && !youtubeUrlsToResolve.has(link.url)) {
        youtubeUrlsToResolve.set(link.url, postUri);
      }
    }
  }

  // Resolve YouTube titles via oEmbed if endpoint is configured
  if (youtubeUrlsToResolve.size > 0 && config.oembedApiUrl) {
    const resolved = await resolveEmbedTitles([...youtubeUrlsToResolve.keys()], {
      apiUrl: config.oembedApiUrl,
    });

    const urlToPostUris = new Map<string, string[]>();
    for (const [postUri, links] of postEmbedLinks) {
      if (postUri === rootAtUri) continue;
      for (const link of links) {
        if (link.platform === 'youtube' && resolved.has(link.url)) {
          const uris = urlToPostUris.get(link.url) ?? [];
          uris.push(postUri);
          urlToPostUris.set(link.url, uris);
        }
      }
    }

    for (const [url, result] of resolved) {
      const parsed = parseEmbedTitle({
        url,
        title: result.title,
        platform: 'youtube',
      });
      if (!parsed) continue;

      const entry: EmbedTitleEntry = { canonical: parsed.canonical, song: parsed.song };
      const postUris = urlToPostUris.get(url) ?? [];
      for (const postUri of postUris) {
        if (!embedTitles.has(postUri)) {
          embedTitles.set(postUri, entry);
        }
      }
    }
  }

  // --- Stage 3: Validate candidates ---
  config.onProgress?.('validating', `${uniqueCandidates.size} candidates`);
  const candidateArray = [...uniqueCandidates];

  let validationLookup: Map<string, ValidationLookupEntry>;

  if (mediaTypes.length > 0 && config.validationApiUrl) {
    // Tier 1: API validation
    const candidateMentions: MediaMention[] = candidateArray.map((title) => {
      const mediaType =
        mediaTypes.length === 1 && mediaTypes[0]
          ? (mediaTypes[0] as MediaMention['mediaType'])
          : ('UNKNOWN' as MediaMention['mediaType']);
      return {
        title,
        normalizedTitle: title.toLowerCase(),
        mediaType,
        confidence: 'medium' as const,
      };
    });

    const validationClient = new ValidationClient({
      apiUrl: config.validationApiUrl,
    });

    const validatedMentions = await validationClient.validateMentions(candidateMentions);
    validationLookup = buildValidationLookup(validatedMentions);
  } else if (customList.length > 0) {
    // Tier 2: List validation
    validationLookup = buildListValidatedLookup(uniqueCandidates, customList);
  } else {
    // Tier 3: Self-validation (default for bot)
    validationLookup = buildSelfValidatedLookup(uniqueCandidates, rootTextLower);
  }

  // --- Stage 4: Build dictionary ---
  config.onProgress?.('counting', `${validationLookup.size} validated`);

  const isListValidated = mediaTypes.length === 0 && customList.length > 0;
  const isSelfValidated = mediaTypes.length === 0 && customList.length === 0;
  const baseDictionaryOptions = isListValidated
    ? { minConfidentForShortTitle: 1 }
    : isSelfValidated
      ? { minConfidentOverall: 2 }
      : {};
  const dictionaryOptions = {
    ...baseDictionaryOptions,
    ...(embedTitles.size > 0 ? { embedTitles } : {}),
  };
  const dictionary = discoverDictionary(
    allPosts,
    postTexts,
    validationLookup,
    rootAtUri,
    rootTextLower,
    dictionaryOptions
  );

  // --- Stage 5: Label posts ---
  config.onProgress?.('labeling', `${dictionary.entries.size} dictionary entries`);
  const postToTitles = labelPosts(
    allPosts,
    postTexts,
    dictionary,
    validationLookup,
    rootAtUri,
    rootTextLower,
    embedTitles.size > 0 ? { embedTitles } : undefined
  );

  // --- Stage 6: Build MentionCount[] ---
  const titleCounts = new Map<string, PostView[]>();
  for (const [postUri, titles] of postToTitles) {
    const post = allPosts.find((p) => p.uri === postUri);
    if (!post) continue;
    for (const title of titles) {
      const existing = titleCounts.get(title);
      if (existing) {
        existing.push(post);
      } else {
        titleCounts.set(title, [post]);
      }
    }
  }

  const mentionCounts: MentionCount[] = [...titleCounts.entries()]
    .map(([title, posts]) => ({
      mention: title,
      count: posts.length,
      posts,
    }))
    .sort((a, b) => b.count - a.count);

  const uncategorizedPosts = allPosts.filter(
    (post) => post.uri !== rootAtUri && !postToTitles.has(post.uri)
  );

  config.onProgress?.('complete', `${mentionCounts.length} mentions found`);

  return { mentionCounts, uncategorizedPosts, postCount: allPosts.length, rootPost };
}
