# Starcounter: Bluesky Post Analyzer Design

## Summary

Starcounter is a static web application for analyzing Bluesky threads and tallying media mentions (movies, TV shows, and music) across replies, quote tweets, and nested conversations. When a user submits a Bluesky post URL, the client fetches the entire thread tree recursively via the AT Protocol public API, extracts media mentions using regex and natural language processing, and displays preliminary results immediately. Behind the scenes, mentions are validated against TMDB and MusicBrainz APIs through serverless functions to ensure accuracy through fuzzy matching. The core innovation is the intelligent counting system: it uses sentiment analysis to determine whether a reply agrees with or disputes a previous mention, applies thread-aware logic to avoid double-counting the same user's repeated mentions within a conversation branch, and aggregates results across the entire discussion tree. Results are visualized with interactive charts where users can drill down to see which posts contributed to each mention's count, and shareable URLs with embedded chart previews allow easy distribution on Bluesky.

The technical architecture follows a hybrid approach: client-side TypeScript handles data fetching, extraction, and visualization for instant feedback, while Cloudflare Workers serverless functions provide validation and Open Graph image generation for social sharing. The project adopts established patterns from the maintainer's other Bluesky projects including strict TypeScript with 95% test coverage targets, colocated tests, Result types for error handling, and token bucket rate limiting to stay within API quotas. The implementation is broken into eight phases progressing from infrastructure setup through thread traversal, mention extraction, smart counting with sentiment analysis, validation APIs, interactive UI with progress tracking, URL sharing with rich previews, and optional advanced sentiment analysis using Transformers.js.

## Definition of Done

**Deliverables:**

1. **Web Application** (hosted on GitHub Pages or similar free hosting)
   - Input: Bluesky post URL via webform
   - Analyzes: Replies (recursive), QTs, QT descendants, replies on QTs
   - Output: Visual breakdown (charts + tables) of mentions

2. **Intelligent Counting System**
   - Extracts mentions from natural language (movies/TV/music)
   - Auto-detects prompt type with user override option
   - Fuzzy validation against external databases (TMDB, MusicBrainz)
   - Sentiment analysis determines agreement (+1) vs disagreement (+0)
   - Supports multiple mentions per reply
   - Avoids double-counting (thread-aware context)

3. **Results Visualization**
   - Quick preview (first ~100-200 items) loads fast
   - Chart/graph showing top mentions
   - Drill-down: Click mention to see contributing posts
   - Shareable URL with chart preview for Bluesky embedding
   - Progress indicator for large/viral threads

4. **Initial Scope**
   - Movies, TV shows, and music only (validated against APIs)
   - Free to run (no ongoing costs)
   - Works with public Bluesky posts (optional app password for rate limits)

**Out of Scope (for now):**
- Other entity types (books, games, etc.)
- Authentication requirements
- Real-time streaming analysis
- Posting results back to Bluesky automatically

## Glossary

- **AT Protocol**: The federated protocol underlying Bluesky, providing APIs for fetching posts, threads, quotes, and other social graph operations
- **Chart.js**: JavaScript library for rendering interactive charts and graphs in the browser
- **Cloudflare Pages/Workers**: Serverless hosting platform where static sites (Pages) and serverless functions (Workers) run without managing servers
- **esbuild**: High-performance JavaScript/TypeScript bundler used to compile source code into production bundles
- **Fuzzy matching**: Approximate string comparison that accounts for typos, variations, and partial matches (e.g., "The Godfather" matches "Godfather")
- **jsdom**: JavaScript implementation of web standards used in tests to simulate browser DOM without launching a real browser
- **LZ-string**: Compression library for encoding data into URL-safe strings, enabling shareable URLs with embedded analysis results
- **MusicBrainz**: Open music encyclopedia API providing metadata about recordings, artists, and releases, with strict rate limits (1 request/second)
- **OG (Open Graph)**: Protocol for controlling how URLs appear when shared on social media, using meta tags and preview images
- **Property-based tests**: Testing approach that validates behavior across randomly generated inputs rather than fixed examples
- **Quote tweet (QT)**: Bluesky post that embeds another post with added commentary, similar to Twitter's quote retweet
- **Rate limiter**: Component that enforces API request quotas by tracking requests over time windows (e.g., 3000 requests per 5 minutes)
- **Result type**: Error-handling pattern `Result<T, E>` that returns either success value or error explicitly, avoiding exceptions for expected failures
- **Sentiment analysis**: Natural language processing technique that determines emotional tone (positive/negative) to detect agreement vs. disagreement
- **TMDB (The Movie Database)**: Movie and TV show metadata API providing validation and fuzzy search capabilities
- **Token bucket**: Rate limiting algorithm that allows bursts of requests while enforcing average rate limits over time
- **Transformers.js**: Browser-compatible machine learning library for advanced NLP tasks, optional upgrade from basic sentiment analysis
- **Vercel**: Alternative serverless hosting platform to Cloudflare, supports similar static site and serverless function patterns
- **Vitest**: Fast unit testing framework for TypeScript/JavaScript, compatible with Jest syntax

## Architecture

Starcounter is a static web application with serverless functions hosted on Cloudflare Pages or Vercel.

**Client-Side (Vanilla TypeScript):**
- Single-page web app with input form for Bluesky post URLs
- Fetches thread data from AT Protocol public API (`public.api.bsky.app`)
- Extracts mentions using regex patterns and NLP
- Displays preliminary results immediately (no validation wait)
- Sends extracted mentions to serverless function for validation
- Updates display with validated, fuzzy-matched results
- Generates interactive bar charts with Chart.js
- Shareable URLs encode analysis results in compressed query parameters

**Serverless Functions (Cloudflare Workers):**
- `/api/validate` - Validates mentions against TMDB/MusicBrainz APIs, returns confidence scores
- `/api/og` - Generates OG preview image (PNG chart) for Bluesky embedding

**External APIs:**
- Bluesky AT Protocol (`public.api.bsky.app`) - Thread/quote fetching, no auth required
- TMDB API (`api.themoviedb.org`) - Movie and TV show validation with fuzzy matching
- MusicBrainz API (`musicbrainz.org/ws/2`) - Music validation (1 req/sec limit)

**Data Flow:**
1. User submits Bluesky post URL
2. Client fetches thread via `getPostThread`, quotes via `getQuotes` (recursive)
3. Client extracts mentions, shows preliminary count with progress bar
4. Client sends mentions to `/api/validate` for fuzzy matching
5. Client updates display with validated results and confidence scores
6. User clicks "Share" → generates URL with compressed results
7. Bluesky crawler visits URL → `/api/og` generates chart preview image

**Key Design Decisions:**
- **Hybrid extraction/validation**: Client-side extraction for instant feedback, serverless validation for accuracy
- **Progressive sentiment analysis**: Lightweight Sentiment.js by default, optional Transformers.js for advanced analysis
- **Thread-aware counting**: Tracks mention novelty within thread branches to avoid double-counting

## Existing Patterns

Investigation of existing Bluesky projects (`~/ergoblock`, `~/bluesky-universe`, `~/advokat`) revealed consistent patterns:

**From ergoblock (Chrome extension, most mature):**
- Strict TypeScript (`"strict": true`, ES2020 target)
- esbuild for bundling via custom `scripts/bundle.js`
- Vitest with jsdom environment
- Colocated tests (`foo.ts` → `foo.test.ts`)
- API client pattern: `getSession()` extracts Bluesky auth from localStorage, `executeApiRequest()` handles timeout/retry/circuit breaker
- Storage helpers with quota checking
- Prettier + ESLint with TypeScript plugin

**From bluesky-universe (feed analyzer):**
- 95% coverage target across all metrics (lines, functions, branches, statements)
- Rate limiter implementation (3000 requests/5 minutes)
- Pagination pattern for large result sets

**From advokat (Next.js app):**
- Result type for error handling (`Result<T, E>`) instead of exceptions
- Functional Core/Imperative Shell separation

**Patterns Starcounter will follow:**
- Strict TypeScript with ergoblock's tsconfig settings
- esbuild bundling with custom script
- Vitest with 95% coverage target (bluesky-universe standard)
- Colocated tests
- Result type for expected failures (advokat pattern)
- Rate limiting for Bluesky API (bluesky-universe implementation)
- Prettier/ESLint configuration from ergoblock

**Reusable code from ergoblock:**
- Session extraction logic from `src/api.ts` (lines 61-141)
- API request helpers with retry/timeout from `src/api.ts` (lines 160-199)
- Rate limiter pattern (adapt from bluesky-universe)

**New patterns introduced:**
- Serverless functions for validation and OG image generation (not present in extension-based projects)
- Client-side NLP for mention extraction
- Thread tree building for smart counting logic

## Implementation Phases

### Phase 1: Project Setup and Infrastructure

**Goal:** Initialize project structure, dependencies, and build pipeline

**Components:**
- `package.json` with dependencies (Chart.js, Sentiment, lz-string, typescript, esbuild, vitest)
- `tsconfig.json` with strict mode (ES2020 target, ESNext modules)
- `vitest.config.ts` with jsdom environment and 95% coverage thresholds
- `.prettierrc` and `eslint.config.js` following ergoblock patterns
- `wrangler.toml` for Cloudflare Pages configuration
- `scripts/bundle.js` for esbuild bundling
- `public/index.html` with basic layout and form

**Dependencies:** None (first phase)

**Done when:** `npm install` succeeds, `npm run build` produces `dist/` output, `npm test` runs (no tests yet), project structure matches design

### Phase 2: Bluesky AT Protocol Client

**Goal:** Fetch thread data from Bluesky API with rate limiting

**Components:**
- `src/api/bluesky-client.ts` - AT Protocol API wrapper (getPostThread, getQuotes)
- `src/api/rate-limiter.ts` - 3000 requests/5min token bucket implementation
- `src/types.ts` - TypeScript interfaces (Post, Thread, BlueskyResponse)
- `src/api/bluesky-client.test.ts` - Tests for API client
- `src/api/rate-limiter.test.ts` - Tests for rate limiter

**Dependencies:** Phase 1 (project setup)

**Done when:** Can fetch threads and quotes from Bluesky, rate limiter prevents exceeding 3000/5min, pagination works for large result sets, all tests pass

### Phase 3: Thread Tree Builder and Mention Extraction

**Goal:** Parse thread structure and extract media mentions from text

**Components:**
- `src/lib/thread-builder.ts` - Builds tree from flat post list, identifies branches
- `src/lib/mention-extractor.ts` - Regex + NLP patterns for movies/TV/music
- `src/lib/prompt-detector.ts` - Auto-detects prompt type from root post text
- `src/lib/thread-builder.test.ts` - Tests for tree construction
- `src/lib/mention-extractor.test.ts` - Tests for extraction (including property-based tests)

**Dependencies:** Phase 2 (Bluesky client)

**Done when:** Can build thread tree with parent/child relationships, extracts mentions from natural language, auto-detects prompt type, handles multiple mentions per post, all tests pass

### Phase 4: Smart Counting Logic with Sentiment Analysis

**Goal:** Count mentions intelligently with thread-awareness and agreement detection

**Components:**
- `src/lib/counter.ts` - Smart counting algorithm (tracks novelty, aggregates by sentiment)
- `src/lib/sentiment-analyzer.ts` - Sentiment.js wrapper with agreement keywords
- `src/lib/counter.test.ts` - Tests for counting rules (novel, agreement, disagreement scenarios)
- `src/lib/sentiment-analyzer.test.ts` - Tests for sentiment detection

**Dependencies:** Phase 3 (thread builder, mention extractor)

**Done when:** Novel mentions count +1, agreement replies count +1, disagreement replies count +0, same author re-mentions count +0, separate threads count independently, all tests pass

### Phase 5: Validation Serverless Function

**Goal:** Fuzzy-match mentions against TMDB and MusicBrainz APIs

**Components:**
- `functions/api/validate.ts` - Serverless function for mention validation
- `src/lib/validation-client.ts` - Client-side wrapper for calling validation API
- Result caching (15-min TTL) in serverless function
- `functions/api/validate.test.ts` - Tests for validation logic
- Environment variables: `TMDB_API_KEY`, `MUSICBRAINZ_USER_AGENT`

**Dependencies:** Phase 3 (mention extractor defines mention format)

**Done when:** Validates movies/TV via TMDB, validates music via MusicBrainz (respects 1 req/sec), returns confidence scores, caches results, handles API errors gracefully, all tests pass

### Phase 6: Client UI with Progress Tracking

**Goal:** Interactive web interface with real-time progress and cancellation

**Components:**
- `src/components/input-form.ts` - Post URL input with validation
- `src/components/progress-bar.ts` - Progress indicator with stall detection
- `src/components/results-chart.ts` - Chart.js bar chart wrapper
- `src/components/drill-down.ts` - Click handler for viewing contributing posts
- `src/lib/progress-tracker.ts` - Progress event system with heartbeat
- `src/main.ts` - Main application orchestration
- `src/styles.css` - UI styling

**Dependencies:** Phases 2-5 (all backend functionality)

**Done when:** Can submit post URL, see progress through phases, cancel long operations, view preliminary results immediately, see validated results after API call, click bars to drill down, all UI interactions work

### Phase 7: URL Sharing and OG Image Generation

**Goal:** Shareable URLs with rich Bluesky previews

**Components:**
- `src/lib/url-encoder.ts` - Compress and encode results to URL params (LZ-string + base64)
- `functions/api/og.tsx` - Serverless function generating chart PNG for OG images
- Share button in UI
- OG meta tags in `public/index.html`

**Dependencies:** Phase 6 (results display)

**Done when:** Can generate shareable URL (<2000 chars), URL decodes back to results, OG image renders chart correctly (1200x630), Bluesky shows rich preview when URL posted

### Phase 8: Advanced Sentiment Analysis (Optional)

**Goal:** Opt-in advanced sentiment with Transformers.js

**Components:**
- `src/lib/transformers-analyzer.ts` - Lazy-loaded Transformers.js integration
- Toggle in UI for "Use advanced analysis"
- Quantized model loading (reduce from 111MB to ~30MB)

**Dependencies:** Phase 4 (sentiment analyzer interface)

**Done when:** Can toggle advanced mode, Transformers.js loads lazily, detects nuanced agreement/disagreement (sarcasm, mixed sentiment), UI shows when advanced mode is active

## Additional Considerations

**Rate Limiting Strategy:**
Bluesky API limits are 3000 requests per 5 minutes per IP. For viral posts with 1000+ replies + quotes, analysis may approach this limit. Strategy:
- Token bucket rate limiter enforces 3000/5min
- Exponential backoff on 429 responses (1s, 2s, 4s delays)
- Progress indicator shows request rate ("~15 requests/sec")
- User can cancel to view partial results

**Error Recovery:**
- API timeouts (>30s): Retry up to 3x with exponential backoff
- Validation API failures: Fall back to unvalidated results with warning
- Deleted posts in thread: Skip gracefully, don't break tree traversal
- Network failures: Show "Retry" button with partial results

**Edge Cases:**
- **Ambiguous mentions**: "Avatar" could be movie or TV show → Show both with confidence scores, drill-down reveals context
- **Very large threads** (>2000 posts): Warn user before fetching, show "This may take 2-3 minutes"
- **Non-English text**: Still attempt extraction, confidence scores reflect uncertainty
- **Circular quote chains**: Track visited URIs in Set, skip duplicates
- **Quote recursion depth**: Limit to 10 levels to prevent infinite loops

**Privacy:**
- No server-side storage of analysis results
- Shareable URLs contain no personal information
- All processing happens client-side except validation API calls
- No tracking or analytics by default

**Performance Targets:**
- Initial page load: <2s (good 4G connection)
- Time to Interactive: <3s
- First Contentful Paint: <1s
- Bundle size: <150KB gzipped (excluding optional Transformers.js)
- Analysis of 500-post thread: <30 seconds
