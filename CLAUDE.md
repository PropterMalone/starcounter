# Starcounter: Bluesky Post Analyzer

## Project Purpose

Starcounter is a web application that analyzes Bluesky threads and tallies media mentions from participating users. It processes Bluesky post URLs, extracts thread conversations, identifies media (images, videos, audio), performs sentiment analysis on posts, and presents results through interactive charts and visualizations.

## Technology Stack

### Core Languages and Runtimes

- **TypeScript 5.9** - Strict mode for type safety
- **ES2020** - Modern JavaScript target
- **Node.js** - Development and build environment

### Build and Bundling

- **esbuild 0.27** - Fast bundling to single ES module
- **Bundle output:** Single `dist/bundle.js` (ES2020 ESM format)

### Frontend

- **Chart.js 4.5** - Interactive charts and data visualization
- **Vanilla TypeScript** - No framework dependencies
- **DOM APIs** - Direct DOM manipulation in `src/ui/` modules

### Testing

- **Vitest 4** - Unit test framework
- **jsdom** - Browser API simulation for DOM tests
- **@vitest/coverage-v8** - Coverage reporting
- **Coverage thresholds:** 95% lines, functions, branches, statements

### Code Quality

- **ESLint 9** - Linting with flat config format
- **typescript-eslint 8.54** - TypeScript-specific rules
- **Prettier 3** - Code formatting (single quotes, 100 char line width)

### External Libraries

- **lz-string 1.5** - String compression for URL sharing
- **sentiment 5.0** - Sentiment analysis for posts

## Architecture

### Directory Structure

```
├── src/
│   ├── main.ts                 # Entry point
│   ├── api/                    # Bluesky AT Protocol client (Phase 2)
│   ├── models/                 # Thread, post, mention data structures (Phase 3)
│   ├── counting/               # Counting and aggregation logic (Phase 4)
│   ├── validation/             # Validation APIs (Phase 5)
│   ├── ui/                     # User interface and interactions (Phase 6)
│   ├── sharing/                # URL sharing and compression (Phase 7)
│   └── sentiment/              # Advanced sentiment analysis (Phase 8)
├── public/
│   ├── index.html              # Main HTML page
│   └── styles.css              # Global styles
├── scripts/
│   └── bundle.js               # esbuild bundling script
├── dist/                       # Build output (gitignored)
├── coverage/                   # Test coverage reports (gitignored)
└── docs/
    └── implementation-plans/   # Phase implementation guides
```

### Build Pipeline

1. **Format check:** `npm run format:check` (Prettier)
2. **Lint:** `npm run lint` (ESLint)
3. **Type check:** `npm run type-check` (TypeScript compiler)
4. **Tests:** `npm run test:coverage` (Vitest with coverage)
5. **Build:** `npm run build` (esbuild bundling)

Full validation: `npm run validate` (runs all above in sequence)

### Testing Methodology

- **Pattern:** Colocated tests (`foo.ts` → `foo.test.ts`)
- **Coverage target:** 95% across all metrics
- **Environment:** jsdom for DOM testing
- **Mocking:** External APIs (Bluesky AT Protocol) mocked in tests
- **Database:** Uses real instance when applicable
- **TDD:** Tests written alongside/after implementation (not required upfront)

## Development Conventions

### Code Style

- **Language:** TypeScript strict mode
- **Quotes:** Single quotes (enforced by Prettier and ESLint)
- **Line width:** 100 characters max (Prettier)
- **Line endings:** LF on all platforms (`.gitattributes`)
- **Semicolons:** Always required
- **Trailing commas:** ES5 style

### Error Handling

- Return errors explicitly (avoid throwing for expected failures)
- Use semantic exit codes and rich diagnostics
- Error messages: lowercase fragments (e.g., "failed to connect to database")
- Two-tier model: user-facing errors vs. internal programming errors

### Type Safety

- Strict mode enabled
- No `any` types without justification
- `noUncheckedIndexedAccess` enforced (check array bounds)
- `noPropertyAccessFromIndexSignature` enforced (type-safe property access)
- `noUnusedLocals` and `noUnusedParameters` enforced

### File Organization

- Descriptive file names by content (not generic `utils.ts` or `helpers.ts`)
- Modules stay under 300 lines (refactor if larger)
- Related code stays together
- Platform-specific code in separate files (`unix.ts`, `windows.ts`, etc.)

### Git Workflow

- Branch off `main` for feature work
- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`
- PR requires >95% coverage, passing tests, lint, format
- Never commit `.env` files (maintain `.env.example` with all required vars)
- Always commit `package-lock.json`

### Module Boundaries

- Strict visibility boundaries between modules
- Clear contracts at module interfaces
- Dependencies documented in module comments
- Avoid circular dependencies

## Quality Gates

Before committing:

```bash
npm run format:check  # Prettier format validation
npm run lint         # ESLint validation
npm run type-check   # TypeScript compiler validation
npm run test:coverage # Vitest with 95% coverage requirement
```

Full validation in CI/CD:

```bash
npm run validate     # Runs all above checks sequentially
```

## Implementation Phases

**Phase 1** (Current): Project infrastructure (package.json, TypeScript, Vitest, ESLint, Prettier, build pipeline, HTML/CSS)

**Phase 2:** Bluesky AT Protocol client with rate limiting

**Phase 3:** Thread builder and mention extraction

**Phase 4:** Smart counting logic

**Phase 5:** Validation APIs

**Phase 6:** UI interactions and form handling

**Phase 7:** URL sharing with compression

**Phase 8:** Advanced sentiment analysis

## Cross-Platform Considerations

- **Line endings:** Always LF (via `.gitattributes`)
- **Path handling:** Use platform-native APIs, not emulation
- **Testing:** All tests run on target platforms (Windows, macOS, Linux)
- **Documentation:** Note platform differences when they exist

## External API Integration

### Bluesky AT Protocol

- **Mocked in tests:** All test data uses fixtures
- **Rate limiting:** Implemented with exponential backoff
- **Error handling:** Network failures handled gracefully
- **Credentials:** Never committed (environment variables only)

## Deployment

Static web application deployed to:

- **Build output:** `dist/bundle.js` (single ES module)
- **Assets:** `public/index.html`, `public/styles.css`
- **No backend:** Serverless functions only (future phases)

---

**Last updated:** 2026-02-04
**Phase:** 1 of 8
