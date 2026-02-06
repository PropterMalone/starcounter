// pattern: Functional Core
export type MediaType = 'MOVIE' | 'TV_SHOW' | 'MUSIC' | 'VIDEO_GAME' | 'UNKNOWN';

export const MediaType = {
  MOVIE: 'MOVIE' as const,
  TV_SHOW: 'TV_SHOW' as const,
  MUSIC: 'MUSIC' as const,
  VIDEO_GAME: 'VIDEO_GAME' as const,
  UNKNOWN: 'UNKNOWN' as const,
};

export type MediaMention = {
  readonly title: string;
  readonly normalizedTitle: string;
  readonly mediaType: MediaType;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly artist?: string; // For music
  readonly context?: string; // Surrounding text for debugging
};

const MOVIE_KEYWORDS = ['watched', 'saw', 'film', 'cinema', 'theater', 'theatre', 'movie'];
const TV_KEYWORDS = ['watching', 'episode', 'season', 'series', 'binge', 'show', 'tv'];
const MUSIC_KEYWORDS = [
  'listening',
  'heard',
  'song',
  'album',
  'artist',
  'track',
  'music',
  'playing',
];

const VIDEO_GAME_KEYWORDS = [
  'played',
  'playing',
  'beat',
  'completed',
  'finished',
  'gaming',
  'gamer',
  'game',
  'games',
  'videogame',
  'video game',
  'steam',
  'playstation',
  'xbox',
  'nintendo',
  'switch',
  'pc',
  'console',
  'rpg',
  'mmo',
  'fps',
  'roguelike',
  'metroidvania',
  'souls',
  'soulslike',
  'platinum',
  'speedrun',
];

const NOISE_WORDS = new Set([
  'yes',
  'no',
  'okay',
  'ok',
  'hello',
  'world',
  'hi',
  'hey',
  'have',
  'thanks',
  'thank you',
  'please',
]);

// Expanded list of common English words that appear capitalized but aren't titles
// This catches sentence-starting words and common nouns
const COMMON_WORDS = new Set([
  // Verbs (often sentence starters)
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'be',
  'is',
  'are',
  'was',
  'were',
  'can',
  'could',
  'would',
  'should',
  'may',
  'might',
  'must',
  'shall',
  'will',
  'want',
  'need',
  'think',
  'know',
  'feel',
  'see',
  'saw',
  'seen',
  'look',
  'looking',
  'watch',
  'watching',
  'watched',
  'love',
  'loved',
  'like',
  'liked',
  'hate',
  'hated',
  'take',
  'takes',
  'took',
  'taken',
  'make',
  'makes',
  'made',
  'get',
  'gets',
  'got',
  'give',
  'gives',
  'gave',
  'come',
  'comes',
  'came',
  'go',
  'goes',
  'went',
  'gone',
  'said',
  'says',
  'tell',
  'told',
  'ask',
  'asked',
  'try',
  'tried',
  'use',
  'used',
  'find',
  'found',
  'keep',
  'kept',
  'let',
  'begin',
  'began',
  'seem',
  'seems',
  'help',
  'show',
  'hear',
  'heard',
  'play',
  'run',
  'move',
  'live',
  'believe',
  'hold',
  'bring',
  'happen',
  'write',
  'provide',
  'sit',
  'stand',
  'lose',
  'pay',
  'meet',
  'include',
  'continue',
  'set',
  'learn',
  'change',
  'lead',
  'understand',
  'remember',
  'follow',
  'stop',
  'create',
  'speak',
  'read',
  'spend',
  'recommend',
  'suggest',
  'try',
  'enjoy',
  'play',
  'played',
  'playing',
  'check',
  'checking',
  'grow',
  'open',
  'walk',
  'win',
  'offer',
  'appear',
  'buy',
  'wait',
  'serve',
  'die',
  'send',
  'expect',
  'build',
  'stay',
  'fall',
  'cut',
  'reach',
  'kill',
  'remain',

  // Adverbs (very common sentence starters)
  'absolutely',
  'actually',
  'already',
  'also',
  'always',
  'anyway',
  'apparently',
  'basically',
  'certainly',
  'clearly',
  'completely',
  'currently',
  'definitely',
  'easily',
  'especially',
  'essentially',
  'eventually',
  'exactly',
  'extremely',
  'finally',
  'fortunately',
  'frankly',
  'frequently',
  'generally',
  'genuinely',
  'greatly',
  'hardly',
  'heavily',
  'highly',
  'honestly',
  'hopefully',
  'however',
  'immediately',
  'importantly',
  'increasingly',
  'indeed',
  'initially',
  'instead',
  'interestingly',
  'just',
  'largely',
  'lately',
  'later',
  'likely',
  'literally',
  'mainly',
  'maybe',
  'meanwhile',
  'merely',
  'mostly',
  'naturally',
  'nearly',
  'necessarily',
  'never',
  'normally',
  'notably',
  'obviously',
  'occasionally',
  'often',
  'only',
  'originally',
  'otherwise',
  'overall',
  'particularly',
  'perhaps',
  'personally',
  'possibly',
  'potentially',
  'practically',
  'precisely',
  'presumably',
  'previously',
  'primarily',
  'probably',
  'properly',
  'quickly',
  'quite',
  'randomly',
  'rarely',
  'rather',
  'really',
  'reasonably',
  'recently',
  'relatively',
  'remarkably',
  'sadly',
  'seriously',
  'significantly',
  'similarly',
  'simply',
  'slightly',
  'slowly',
  'somehow',
  'sometimes',
  'somewhat',
  'soon',
  'specifically',
  'still',
  'strongly',
  'suddenly',
  'supposedly',
  'surely',
  'surprisingly',
  'technically',
  'therefore',
  'thoroughly',
  'though',
  'thus',
  'together',
  'totally',
  'truly',
  'typically',
  'ultimately',
  'unfortunately',
  'unless',
  'unlikely',
  'usually',
  'very',
  'virtually',
  'well',
  'widely',

  // Pronouns and determiners
  'the',
  'a',
  'an',
  'this',
  'that',
  'these',
  'those',
  'my',
  'your',
  'his',
  'her',
  'its',
  'our',
  'their',
  'some',
  'any',
  'no',
  'every',
  'each',
  'all',
  'both',
  'few',
  'more',
  'most',
  'other',
  'another',
  'such',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'whatever',
  'whoever',
  'whichever',

  // Conjunctions and prepositions
  'and',
  'or',
  'but',
  'if',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'without',
  'about',
  'against',
  'between',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'from',
  'up',
  'down',
  'out',
  'off',
  'over',
  'under',
  'again',
  'further',
  'then',
  'once',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'because',
  'since',
  'while',
  'although',
  'though',
  'unless',
  'until',
  'whether',

  // Common nouns (not typically titles on their own)
  'movie',
  'film',
  'show',
  'series',
  'book',
  'song',
  'album',
  'game',
  'story',
  'people',
  'person',
  'man',
  'woman',
  'child',
  'children',
  'guy',
  'girl',
  'boy',
  'family',
  'friend',
  'friends',
  'group',
  'team',
  'company',
  'government',
  'world',
  'country',
  'state',
  'city',
  'place',
  'home',
  'house',
  'school',
  'life',
  'time',
  'year',
  'years',
  'day',
  'days',
  'week',
  'month',
  'night',
  'morning',
  'evening',
  'today',
  'yesterday',
  'tomorrow',
  'moment',
  'minute',
  'thing',
  'things',
  'stuff',
  'something',
  'nothing',
  'everything',
  'anything',
  'way',
  'part',
  'case',
  'point',
  'fact',
  'problem',
  'question',
  'answer',
  'reason',
  'result',
  'end',
  'kind',
  'sort',
  'type',
  'lot',
  'bit',
  'number',
  'work',
  'job',
  'business',
  'money',
  'power',
  'hand',
  'side',
  'head',
  'eye',
  'face',
  'body',
  'water',
  'food',
  'car',
  'door',
  'room',
  'name',
  'word',
  'ocean',
  'oceans',
  'dude',
  'dudes',
  'guys',
  'folks',
  'kids',
  'movies',

  // More common nouns that appear in sentences
  'ending',
  'beginning',
  'middle',
  'mind',
  'heart',
  'soul',
  'thought',
  'idea',
  'opinion',
  'view',
  'feeling',
  'sense',
  'reason',
  'meaning',
  'purpose',
  'goal',
  'plan',
  'decision',
  'choice',
  'chance',
  'luck',
  'fate',
  'truth',
  'lie',
  'secret',
  'surprise',
  'shock',
  'joy',
  'pain',
  'pleasure',
  'fun',
  'music',
  'sound',
  'voice',
  'noise',
  'silence',
  'scene',
  'shot',
  'moment',
  'second',
  'hour',

  // Adjectives (often before nouns, not titles)
  'good',
  'great',
  'bad',
  'best',
  'worst',
  'nice',
  'cool',
  'awesome',
  'amazing',
  'beautiful',
  'big',
  'small',
  'little',
  'long',
  'short',
  'high',
  'low',
  'new',
  'old',
  'young',
  'different',
  'same',
  'other',
  'important',
  'large',
  'real',
  'true',
  'right',
  'wrong',
  'sure',
  'possible',
  'able',
  'free',
  'full',
  'special',
  'easy',
  'hard',
  'clear',
  'certain',
  'whole',
  'particular',
  'recent',
  'major',
  'personal',
  'local',
  'national',
  'international',
  'political',
  'social',
  'public',
  'private',
  'main',
  'common',
  'general',
  'single',
  'simple',
  'final',
  'past',
  'present',
  'future',
  'early',
  'late',
  'available',
  'popular',
  'similar',

  // Archaic/poetic (for "O Brother Where Art Thou" type handling)
  'art',
  'where',
  'thou',
  'thee',
  'thy',
  'thine',
  'brother',
  'o',

  // Other common sentence starters
  'plus',
  'minus',
  'super',
  'kinda',
  'sorta',
  'gotta',
  'gonna',
  'wanna',
  'many',
  'much',
  'several',
  'various',
  'numerous',
  'multiple',
]);

/**
 * Extracts media mentions from natural language text
 * Uses regex patterns + context keywords for classification
 */
export class MentionExtractor {
  /**
   * Extract media mentions from text
   * @param text - Post text to analyze
   * @param defaultMediaType - Media type to use when context is unclear
   */
  extractMentions(text: string, defaultMediaType?: MediaType): Array<MediaMention> {
    const mentions: Array<MediaMention> = [];

    // Split text into lines to handle newline-separated lists
    // (e.g., "Gettysburg\nAll the President's Men\nReservoir Dogs")
    const lines = text.split(/\n/);

    for (const line of lines) {
      // Skip empty lines
      if (!line.trim()) continue;

      // Strategy 1: Quoted text (high confidence)
      const quotedMentions = this.extractQuoted(line, defaultMediaType);
      mentions.push(...quotedMentions);

      // Strategy 2: Title case (medium confidence)
      const titleCaseMentions = this.extractTitleCase(line, defaultMediaType);
      mentions.push(...titleCaseMentions);

      // Strategy 3: ALL CAPS (medium confidence)
      const allCapsMentions = this.extractAllCaps(line, defaultMediaType);
      mentions.push(...allCapsMentions);

      // Strategy 4: Single rare words (low confidence - relies on TMDB validation)
      // Catches titles like "Ronin", "Amélie", "Tenet" that are uncommon English words
      const rareWordMentions = this.extractRareWords(line, defaultMediaType);
      mentions.push(...rareWordMentions);

      // Strategy 5: Lowercase multi-word phrases (low confidence - relies on validation)
      // Catches casual mentions like "disco elysium", "baldur's gate 3", "elden ring"
      const lowercaseMentions = this.extractLowercaseMultiWord(line, defaultMediaType);
      mentions.push(...lowercaseMentions);
    }

    // Deduplicate by normalized title, preferring longer titles when one is a substring of another
    // This ensures "Hunt for Red October" wins over "RED" and "Indiana Jones" wins over "JONES"
    return this.deduplicateMentions(mentions);
  }

  /**
   * Normalize title for matching (remove leading articles, lowercase)
   */
  normalizeTitle(title: string): string {
    const articles = ['the', 'a', 'an'];
    const words = title.toLowerCase().split(/\s+/);

    const firstWord = words[0];
    if (words.length > 1 && firstWord && articles.includes(firstWord)) {
      return words.slice(1).join(' ');
    }

    return title.toLowerCase();
  }

  /**
   * Deduplicate mentions, preferring longer titles when one is a substring of another.
   * "Hunt for Red October" wins over "RED", "Indiana Jones" wins over "JONES"
   */
  private deduplicateMentions(mentions: Array<MediaMention>): Array<MediaMention> {
    // Sort by normalized title length descending - process longer titles first
    const sorted = [...mentions].sort(
      (a, b) => b.normalizedTitle.length - a.normalizedTitle.length
    );

    const kept: Array<MediaMention> = [];

    for (const mention of sorted) {
      const dominated = kept.some((existing) => {
        // Check if the longer (existing) title contains this shorter title as a substring
        // Use word boundary check to avoid false positives like "heat" in "theater"
        const pattern = new RegExp(`\\b${this.escapeRegex(mention.normalizedTitle)}\\b`, 'i');
        return pattern.test(existing.normalizedTitle);
      });

      if (!dominated) {
        // Also check we haven't already added an exact match
        const exactDupe = kept.some((e) => e.normalizedTitle === mention.normalizedTitle);
        if (!exactDupe) {
          kept.push(mention);
        }
      }
    }

    return kept;
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Extract quoted text (high confidence)
   */
  private extractQuoted(text: string, defaultMediaType?: MediaType): Array<MediaMention> {
    const mentions: Array<MediaMention> = [];

    // Regex: quoted text - match content between quotes, handling escaped quotes and apostrophes
    const quotedPattern = /"([^"]+)"/g;
    let match;

    while ((match = quotedPattern.exec(text)) !== null) {
      const capturedTitle = match[1];
      if (!capturedTitle) {
        continue;
      }
      const title = capturedTitle.trim();

      // Validate title
      if (!this.isValidTitle(title)) {
        continue;
      }

      // Get context around the quote
      const contextStart = Math.max(0, match.index - 50);
      const contextEnd = Math.min(text.length, match.index + match[0].length + 50);
      const context = text.slice(contextStart, contextEnd);

      // Classify media type from context
      const mediaType = defaultMediaType ?? this.classifyFromContext(context);

      // Extract artist for music
      const artist =
        mediaType === MediaType.MUSIC ? this.extractArtist(text, match.index) : undefined;

      mentions.push({
        title,
        normalizedTitle: this.normalizeTitle(title),
        mediaType,
        confidence: 'high',
        artist,
        context,
      });
    }

    return mentions;
  }

  /**
   * Extract title case text (medium confidence)
   * Much stricter than before - requires multiple capitalized words
   */
  private extractTitleCase(text: string, defaultMediaType?: MediaType): Array<MediaMention> {
    const mentions: Array<MediaMention> = [];

    // Find sentence start positions
    const sentenceStarts = this.findSentenceStarts(text);

    // Regex: Title case sequences - captures multi-word titles with optional connectors
    // Pattern: CapWord (separator (connectors separator)* CapWord)+
    // Separators: space, colon+space, hyphen
    // Connectors can repeat (e.g., "of the" in "The Far Side of the World")
    // This matches: "The Matrix", "Hunt for Red October", "Master and Commander: The Far Side of the World"
    const titleCasePattern =
      /\b([A-Z][a-z']+(?:(?:\s+|:\s*|-\s*)(?:(?:for|the|and|of|a|an|in|on|at|to|is|&)(?:\s+|:\s*|-\s*))*[A-Z][a-z']+)+)/g;
    let match;

    while ((match = titleCasePattern.exec(text)) !== null) {
      const captured = match[1];
      if (!captured) {
        continue;
      }
      let title = captured.trim();
      const position = match.index;

      // Strip trailing possessive 's from last word (e.g., "The Matrix's" -> "The Matrix")
      title = title.replace(/'s$/i, '');

      // Check if first word is at sentence start
      if (this.isAtSentenceStart(position, sentenceStarts)) {
        // Try to salvage by removing the first word if there are enough remaining
        const salvaged = this.removeFirstWordIfSentenceStart(title);
        if (!salvaged) {
          continue;
        }
        title = salvaged;
      }

      // Count all capitalized words (including articles like "The")
      // Split on spaces, colons, and hyphens
      const allWords = title.split(/[\s:-]+/).filter((w) => w.length > 0);
      const capitalizedWords = allWords.filter((w) => /^[A-Z]/.test(w));

      // Require at least 2 total words (including articles)
      if (allWords.length < 2 || capitalizedWords.length < 2) {
        continue;
      }

      // Skip if ALL capitalized words are common words (likely not a title)
      // EXCEPTION: if title contains "and", "&", or "of" as connector AND has meaningful words
      // (e.g., "Master and Commander", "Master & Commander", "Bride of Frankenstein")
      // Meaningful words = words with 4+ chars (filters out pure preposition phrases like "AND OF IN AT")
      const hasConnector = /(?:\b(?:and|of)\b|&)/i.test(title);
      const hasMeaningfulWords = capitalizedWords.some((w) => w.length >= 4);
      const nonCommonCaps = capitalizedWords.filter((w) => !COMMON_WORDS.has(w.toLowerCase()));
      if (nonCommonCaps.length === 0 && !(hasConnector && hasMeaningfulWords)) {
        continue;
      }

      // Validate title
      if (!this.isValidTitle(title)) {
        continue;
      }

      // Get context
      const contextStart = Math.max(0, position - 50);
      const contextEnd = Math.min(text.length, position + match[0].length + 50);
      const context = text.slice(contextStart, contextEnd);

      // Classify media type
      const mediaType = defaultMediaType ?? this.classifyFromContext(context);

      mentions.push({
        title,
        normalizedTitle: this.normalizeTitle(title),
        mediaType,
        confidence: 'medium',
        context,
      });
    }

    return mentions;
  }

  /**
   * Extract ALL CAPS titles (medium confidence)
   * Example: "STAR TREK II", "TOP GUN: MAVERICK", "MASTER & COMMANDER"
   */
  private extractAllCaps(text: string, defaultMediaType?: MediaType): Array<MediaMention> {
    const mentions: Array<MediaMention> = [];

    // Find sentence start positions
    const sentenceStarts = this.findSentenceStarts(text);

    // Pattern: 2+ ALL CAPS words (2+ letters each) with optional connectors
    // Connectors: space, colon, ampersand, hyphen
    // Also allows common connector words in caps: THE, A, AN, OF, AND, FOR, etc.
    const allCapsPattern =
      /\b([A-Z]{2,}(?:[\s:&-]+(?:THE|A|AN|OF|AND|IN|ON|AT|TO|IS|FOR|II|III|IV|V|VI|VII|VIII|IX|X)?[\s:&-]*[A-Z]{2,})+)\b/g;

    let match;
    while ((match = allCapsPattern.exec(text)) !== null) {
      const captured = match[1];
      if (!captured) {
        continue;
      }

      let title = captured.trim();
      const position = match.index;

      // Check if first word is at sentence start - skip leading common word
      if (this.isAtSentenceStart(position, sentenceStarts)) {
        const salvaged = this.removeFirstWordIfSentenceStartAllCaps(title);
        if (!salvaged) {
          continue;
        }
        title = salvaged;
      }

      // Split into words (handling separators)
      const allWords = title.split(/[\s:&-]+/).filter((w) => w.length > 0);

      // Require at least 2 words
      if (allWords.length < 2) {
        continue;
      }

      // Count non-common ALL CAPS words
      // EXCEPTION: if title contains "AND", "&", or "OF" as connector AND has meaningful words
      // Meaningful words = words with 4+ chars (filters out pure preposition phrases)
      const hasConnectorAllCaps = /(?:\bAND\b|\bOF\b|&)/i.test(title);
      const hasMeaningfulWordsAllCaps = allWords.some((w) => w.length >= 4);
      const nonCommonWords = allWords.filter((w) => !COMMON_WORDS.has(w.toLowerCase()));
      if (nonCommonWords.length === 0 && !(hasConnectorAllCaps && hasMeaningfulWordsAllCaps)) {
        continue;
      }

      // Convert to Title Case for display and matching
      const titleCased = this.allCapsToTitleCase(title);

      if (!this.isValidTitle(titleCased)) {
        continue;
      }

      // Get context
      const contextStart = Math.max(0, position - 50);
      const contextEnd = Math.min(text.length, position + match[0].length + 50);
      const context = text.slice(contextStart, contextEnd);

      // Classify media type
      const mediaType = defaultMediaType ?? this.classifyFromContext(context);

      mentions.push({
        title: titleCased,
        normalizedTitle: this.normalizeTitle(titleCased),
        mediaType,
        confidence: 'medium',
        context,
      });
    }

    return mentions;
  }

  /**
   * Extract single rare/uncommon words that might be movie titles
   * Catches titles like "Ronin", "Amélie", "Tenet", "Arrival"
   * These are single capitalized words NOT in COMMON_WORDS
   */
  private extractRareWords(text: string, defaultMediaType?: MediaType): Array<MediaMention> {
    const mentions: Array<MediaMention> = [];

    // Find sentence start positions to avoid extracting sentence-starting words
    const sentenceStarts = this.findSentenceStarts(text);

    // Pattern: single capitalized word (4+ chars) not followed by another cap word
    // This avoids matching the first word of multi-word titles
    // Supports accented characters like Amélie, Léon
    const rareWordPattern = /\b([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ']{3,})\b(?!\s+[A-ZÀ-ÖØ-Þ])/g;
    let match;

    while ((match = rareWordPattern.exec(text)) !== null) {
      const word = match[1];
      if (!word) continue;

      const position = match.index;

      // Allowlist of distinctive single-word movie titles that should be extracted
      // even at sentence start (they're unlikely to be false positives)
      const alwaysExtractTitles = new Set([
        'ronin',
        'amélie',
        'amelie',
        'tenet',
        'arrival',
        'alien',
        'aliens',
        'predator',
        'jaws',
        'psycho',
        'vertigo',
        'notorious',
        'zodiac',
        'chinatown',
        'fargo',
        'heat',
        'collateral',
        'sicario',
        'prisoners',
        'interstellar',
        'dunkirk',
        'oppenheimer',
        'gladiator',
        'braveheart',
        'unforgiven',
        'tombstone',
        'gettysburg',
        'patton',
        'platoon',
      ]);

      // Skip if at sentence start (likely just a regular capitalized word)
      // UNLESS it's in our allowlist of distinctive movie titles
      if (this.isAtSentenceStart(position, sentenceStarts)) {
        if (!alwaysExtractTitles.has(word.toLowerCase())) {
          continue;
        }
      }

      // Skip if it's a common word
      if (COMMON_WORDS.has(word.toLowerCase())) {
        continue;
      }

      // Skip ambiguous single words that cause false positives
      // These are words that TMDB will validate as movies but are commonly used in other contexts
      const ambiguousWords = new Set([
        // Common names
        'john',
        'james',
        'michael',
        'david',
        'robert',
        'william',
        'richard',
        'thomas',
        'mary',
        'patricia',
        'jennifer',
        'linda',
        'elizabeth',
        'barbara',
        'susan',
        // Days and months
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
        'january',
        'february',
        'march',
        'april',
        'june',
        'july',
        'august',
        'september',
        'october',
        'november',
        'december',
        // City names that are also movie titles
        'chicago',
        'paris',
        'rome',
        'berlin',
        'munich',
        'london',
        'brooklyn',
        'philadelphia',
        'casablanca', // Casablanca is OK as multi-word "Casablanca" but risky alone
        // Genre words
        'western',
        'horror',
        'comedy',
        'drama',
        'thriller',
        'action',
        'romance',
        'musical',
        'fantasy',
        'animation',
        'documentary',
        'mystery',
        'crime',
        // Nationality/language words (often false positives like "French" → "French Blood")
        'french',
        'german',
        'italian',
        'spanish',
        'american',
        'british',
        'english',
        'japanese',
        'chinese',
        'korean',
        'russian',
        'indian',
        'mexican',
        'canadian',
        // Other ambiguous words
        'blood',
        'love',
        'war',
        'life',
        'death',
        'hope',
        'fear',
        'time',
        'gold',
        'silver',
        'blue',
        'green',
        'black',
        'white',
        'dark',
        'light',
        'night',
        'day',
        'oceans',
        'ocean', // Should only count as "Ocean's Eleven" etc.
      ]);
      if (ambiguousWords.has(word.toLowerCase())) {
        continue;
      }

      // Get context
      const contextStart = Math.max(0, position - 50);
      const contextEnd = Math.min(text.length, position + match[0].length + 50);
      const context = text.slice(contextStart, contextEnd);

      // Classify media type
      const mediaType = defaultMediaType ?? this.classifyFromContext(context);

      mentions.push({
        title: word,
        normalizedTitle: this.normalizeTitle(word),
        mediaType,
        confidence: 'low', // Low confidence - relies on TMDB validation
        context,
      });
    }

    return mentions;
  }

  /**
   * Extract lowercase multi-word phrases that could be titles
   * Catches casual mentions like "disco elysium", "baldur's gate 3", "elden ring"
   * Low confidence - relies heavily on validation to filter noise
   */
  private extractLowercaseMultiWord(
    text: string,
    defaultMediaType?: MediaType
  ): Array<MediaMention> {
    const mentions: Array<MediaMention> = [];

    // Pattern: 2-5 lowercase words, optionally with numbers, apostrophes, or colons
    // Examples: "disco elysium", "baldur's gate 3", "red dead redemption 2"
    // Excludes words that are ALL common words
    const lowercasePattern = /\b([a-z][a-z']+(?:\s+[a-z0-9':][a-z0-9']*){1,4})\b/g;
    let match;

    while ((match = lowercasePattern.exec(text)) !== null) {
      const phrase = match[1];
      if (!phrase) continue;

      const position = match.index;

      // Split into words
      const words = phrase.split(/\s+/).filter((w) => w.length > 0);

      // Require at least 2 words
      if (words.length < 2) continue;

      // Skip if ALL words are common (likely just normal text)
      const nonCommonWords = words.filter((w) => !COMMON_WORDS.has(w.toLowerCase()));
      if (nonCommonWords.length === 0) continue;

      // Trim leading common words (e.g., "recommend disco elysium" -> "disco elysium")
      while (words.length > 2) {
        const firstWord = words[0];
        if (firstWord && COMMON_WORDS.has(firstWord.toLowerCase())) {
          words.shift();
        } else {
          break;
        }
      }

      // Trim trailing common words (e.g., "disco elysium is amazing" -> "disco elysium")
      // This prevents over-capturing into sentence continuation
      while (words.length > 2) {
        const lastWord = words[words.length - 1];
        if (lastWord && COMMON_WORDS.has(lastWord.toLowerCase())) {
          words.pop();
        } else {
          break;
        }
      }

      // After trimming, re-check if we still have non-common words
      const trimmedNonCommon = words.filter((w) => !COMMON_WORDS.has(w.toLowerCase()));
      if (trimmedNonCommon.length === 0) continue;

      // Rebuild phrase from trimmed words
      const trimmedPhrase = words.join(' ');

      // Skip very short phrases (likely noise)
      if (trimmedPhrase.length < 6) continue;

      // Skip if phrase is just common filler
      const fillerPhrases = new Set([
        'i think',
        'i know',
        'i love',
        'i like',
        'i want',
        'i need',
        'i was',
        'i am',
        'you know',
        'you think',
        'you seen',
        'you saw',
        'you are',
        'you were',
        'it was',
        'it is',
        'that was',
        'that is',
        'this is',
        'this was',
        'so much',
        'too much',
        'a lot',
        'the best',
        'the worst',
        'my favorite',
        'my favourite',
        'for me',
        'to me',
        'to them',
        'to him',
        'to her',
        'to you',
        'to us',
        'of course',
        'in fact',
        'as well',
        'at least',
        'at all',
        'right now',
        'last night',
        'last week',
        'last month',
        'last year',
        'this year',
        'this week',
        'next year',
        'next week',
        'one of',
        'some of',
        'all of',
        'none of',
        'kind of',
        'sort of',
        'a bit',
        'a little',
        'a few',
        'have you',
        'do you',
        'did you',
        'can you',
        'will you',
        'would you',
        'could you',
        'should you',
        'was mind',
        'ending was',
        'beginning was',
      ]);
      if (fillerPhrases.has(trimmedPhrase.toLowerCase())) continue;

      // Skip if phrase starts with a pronoun, demonstrative, or common verb (likely sentence fragment)
      const startsWithCommon =
        /^(i|you|he|she|it|we|they|that|this|there|here|have|has|had|do|does|did|was|were|is|are|am|been|being|i'm|you're|he's|she's|it's|we're|they're|that's|there's|here's|i've|you've|we've|they've|i'd|you'd|he'd|she'd|we'd|they'd|i'll|you'll|he'll|she'll|we'll|they'll|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|won't|wouldn't|can't|couldn't|shouldn't|haven't|hasn't|hadn't)\s/i;
      if (startsWithCommon.test(trimmedPhrase)) continue;

      // Convert to Title Case for display
      const titleCased = this.lowercaseToTitleCase(trimmedPhrase);

      // Get context
      const contextStart = Math.max(0, position - 50);
      const contextEnd = Math.min(text.length, position + match[0].length + 50);
      const context = text.slice(contextStart, contextEnd);

      // Classify media type
      const mediaType = defaultMediaType ?? this.classifyFromContext(context);

      mentions.push({
        title: titleCased,
        normalizedTitle: this.normalizeTitle(titleCased),
        mediaType,
        confidence: 'low', // Low confidence - relies on validation
        context,
      });
    }

    return mentions;
  }

  /**
   * Convert lowercase phrase to Title Case
   * "disco elysium" -> "Disco Elysium"
   * "baldur's gate 3" -> "Baldur's Gate 3"
   */
  private lowercaseToTitleCase(text: string): string {
    return text
      .split(/\s+/)
      .map((word) => {
        if (word.length === 0) return word;
        // Keep numbers as-is
        if (/^\d+$/.test(word)) return word;
        // Capitalize first letter, keep rest (preserves apostrophes)
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }

  /**
   * Convert ALL CAPS to Title Case for display
   * "MASTER & COMMANDER" -> "Master & Commander"
   * "TOP GUN: MAVERICK" -> "Top Gun: Maverick"
   */
  private allCapsToTitleCase(text: string): string {
    return text
      .split(/(\s+|[&:-]+)/)
      .map((part) => {
        // Keep separators as-is
        if (/^[\s&:-]+$/.test(part)) {
          return part;
        }
        // Convert ALL CAPS word to title case
        if (/^[A-Z]+$/.test(part) && part.length > 0) {
          return part.charAt(0) + part.slice(1).toLowerCase();
        }
        return part;
      })
      .join('');
  }

  /**
   * Remove first word from ALL CAPS title if it's a common word at sentence start
   * Returns null only if remaining title would be too short after removing common word
   * Returns title unchanged if first word is not common
   */
  private removeFirstWordIfSentenceStartAllCaps(title: string): string | null {
    const words = title.split(/[\s:&-]+/).filter((w) => w.length > 0);

    const firstWord = words[0];
    // If first word is NOT a common word, keep the title as-is
    if (!firstWord || !COMMON_WORDS.has(firstWord.toLowerCase())) {
      return title;
    }

    // First word is common - need at least 3 words to have 2 left after removal
    if (words.length < 3) {
      return null;
    }

    // Remove the common first word, keeping the rest with original separators
    const firstWordPattern = new RegExp(`^${firstWord}[\\s:&\\-]+`, 'i');
    return title.replace(firstWordPattern, '');
  }

  /**
   * Find positions where sentences start (after .!? or at string start)
   */
  private findSentenceStarts(text: string): Set<number> {
    const starts = new Set<number>();
    starts.add(0); // Start of string

    // After sentence-ending punctuation followed by whitespace
    const pattern = /[.!?]\s+/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      starts.add(match.index + match[0].length);
    }

    // After newlines
    const newlinePattern = /\n\s*/g;
    while ((match = newlinePattern.exec(text)) !== null) {
      starts.add(match.index + match[0].length);
    }

    return starts;
  }

  /**
   * Check if a position is at a sentence start
   */
  private isAtSentenceStart(position: number, sentenceStarts: Set<number>): boolean {
    // Direct match
    if (sentenceStarts.has(position)) {
      return true;
    }

    // Check if only whitespace between a start and this position
    for (const start of sentenceStarts) {
      if (start <= position && position - start <= 5) {
        return true;
      }
    }

    return false;
  }

  /**
   * Remove first word from title if it's likely a sentence-start word
   * Returns null if remaining title is too short
   */
  private removeFirstWordIfSentenceStart(title: string): string | null {
    const words = title.split(/\s+/);
    const firstWord = words[0]?.toLowerCase();

    // Special case: "The/A/An + ProperNoun" is a valid movie title pattern
    // Keep titles like "The Martian", "The Matrix", "A Quiet Place" even at sentence start
    if (words.length === 2 && (firstWord === 'the' || firstWord === 'a' || firstWord === 'an')) {
      const secondWord = words[1];
      // Keep if second word is capitalized and NOT a common word
      if (secondWord && /^[A-Z]/.test(secondWord) && !COMMON_WORDS.has(secondWord.toLowerCase())) {
        return title; // Keep the full "The Martian" style title
      }
    }

    if (words.length < 3) {
      // Not enough words to salvage (and not an article + proper noun pattern)
      return null;
    }

    if (firstWord && COMMON_WORDS.has(firstWord)) {
      // Remove the first word and check if we still have a valid title
      const remaining = words.slice(1).join(' ');
      const remainingCaps = words.slice(1).filter((w) => /^[A-Z]/.test(w)).length;
      if (remainingCaps >= 2) {
        return remaining;
      }
    }

    return title;
  }

  /**
   * Classify media type based on context keywords
   */
  private classifyFromContext(context: string): MediaType {
    const contextLower = context.toLowerCase();

    // Count keyword occurrences
    const movieCount = MOVIE_KEYWORDS.filter((kw) => contextLower.includes(kw)).length;
    const tvCount = TV_KEYWORDS.filter((kw) => contextLower.includes(kw)).length;
    const musicCount = MUSIC_KEYWORDS.filter((kw) => contextLower.includes(kw)).length;
    const gameCount = VIDEO_GAME_KEYWORDS.filter((kw) => contextLower.includes(kw)).length;

    // Return type with most matches
    const max = Math.max(movieCount, tvCount, musicCount, gameCount);

    if (max === 0) {
      return MediaType.UNKNOWN;
    }

    if (movieCount === max) return MediaType.MOVIE;
    if (tvCount === max) return MediaType.TV_SHOW;
    if (musicCount === max) return MediaType.MUSIC;
    if (gameCount === max) return MediaType.VIDEO_GAME;

    return MediaType.UNKNOWN;
  }

  /**
   * Extract artist name for music mentions
   */
  private extractArtist(text: string, titlePosition: number): string | undefined {
    // Look for " by Artist" pattern after the title
    const afterTitle = text.slice(titlePosition);
    const artistPattern =
      /by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:feat\.|featuring|ft\.|with)\s+.+)?)/;
    const match = artistPattern.exec(afterTitle);

    if (!match || !match[1]) {
      return undefined;
    }
    return match[1].trim();
  }

  /**
   * Validate if a title is valid (not noise, not too short)
   */
  private isValidTitle(title: string): boolean {
    // Too short
    if (title.length < 2) {
      return false;
    }

    // Noise words (including "Hello" and "World")
    const lowerTitle = title.toLowerCase();
    if (NOISE_WORDS.has(lowerTitle)) {
      return false;
    }

    // Filter out very common two-word phrases (all lowercase noise)
    const words = lowerTitle.split(/\s+/);
    if (words.every((w) => NOISE_WORDS.has(w))) {
      return false;
    }

    return true;
  }
}
