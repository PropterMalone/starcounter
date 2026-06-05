/**
 * Shared types for the benchmarking harness.
 * Using JSDoc for type hints since bench/ is plain JS (not compiled with the main project).
 */

/**
 * @typedef {Object} FixturePost
 * @property {string} uri
 * @property {string} cid
 * @property {string|null} parentUri
 * @property {number} depth
 * @property {'thread'|'quote'|'quote-reply'} source
 * @property {{did: string, handle: string, displayName: string}} author
 * @property {string} text
 * @property {string} fullText - text + image alt text
 * @property {string} createdAt
 * @property {number} likeCount
 * @property {number} replyCount
 * @property {number} repostCount
 * @property {boolean} hasImages
 * @property {boolean} hasQuote
 * @property {string|null} embedType
 * @property {string|null} quotedText
 * @property {string[]|null} quotedAltText
 */

/**
 * @typedef {Object} GoldLabel
 * @property {string} uri - Post URI (key)
 * @property {string[]} topics - Canonical movie title(s) this post is about
 * @property {boolean} onTopic - Is this post about a dad movie (vs meta/off-topic)
 * @property {'high'|'medium'|'low'} confidence - How confident the labeler is
 * @property {string} [note] - Optional reasoning
 */

/**
 * @typedef {Object} AlgorithmResult
 * @property {string} uri - Post URI
 * @property {string[]} topics - Predicted movie title(s)
 */

/**
 * @typedef {Object} BenchmarkScore
 * @property {string} algorithm - Algorithm name
 * @property {number} precision - True positives / (true positives + false positives)
 * @property {number} recall - True positives / (true positives + false negatives)
 * @property {number} f1 - Harmonic mean of precision and recall
 * @property {number} postsLabeled - How many posts the algorithm labeled as on-topic
 * @property {number} postsCorrect - How many of those were actually on-topic with correct titles
 * @property {number} postsMissed - Posts that were on-topic but algorithm found no titles
 * @property {Object} [perTitle] - Per-title breakdown
 */

export {};
