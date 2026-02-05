# Starcounter: Bluesky Post Analyzer Implementation Plan - Phase 1

**Goal:** Initialize project structure, dependencies, and build pipeline

**Architecture:** Static web application with serverless functions, using vanilla TypeScript compiled with esbuild, tested with Vitest

**Tech Stack:** TypeScript 5.9, esbuild 0.27, Vitest 4, Chart.js 4.5, Sentiment 5.0, lz-string 1.5, ESLint 9, Prettier 3

**Scope:** Phase 1 of 8 phases from original design

**Codebase verified:** 2026-02-04 10:46 UTC

---

## Phase Overview

This phase establishes the project infrastructure: package.json with all dependencies, TypeScript configuration with strict mode, testing setup with Vitest and 95% coverage thresholds, code quality tools (Prettier + ESLint with flat config), basic build pipeline with esbuild bundling script, and initial HTML structure.

**Testing methodology:** This project follows the bluesky-universe standard:
- **Coverage target:** 95% across lines, functions, branches, statements
- **Test pattern:** Colocated tests (`foo.ts` → `foo.test.ts`)
- **Framework:** Vitest with jsdom environment and v8 coverage provider
- **Mocking:** External APIs always mocked, database uses real instance when applicable
- **TDD:** Not required - tests written alongside/after implementation, must pass before phase completion

---

<!-- START_TASK_1 -->
### Task 1: Create package.json with dependencies

**Files:**
- Create: `package.json`

**Step 1: Create package.json**

```json
{
  "name": "starcounter",
  "version": "0.1.0",
  "description": "Bluesky thread analyzer for tallying media mentions",
  "type": "module",
  "scripts": {
    "build": "node scripts/bundle.js",
    "test": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint .",
    "format": "prettier --write \"src/**/*.{ts,js}\" \"public/**/*.{html,css}\"",
    "format:check": "prettier --check \"src/**/*.{ts,js}\" \"public/**/*.{html,css}\"",
    "type-check": "tsc --noEmit",
    "validate": "npm run format:check && npm run lint && npm run type-check && npm run test:coverage"
  },
  "keywords": ["bluesky", "analyzer", "media", "sentiment"],
  "author": "",
  "license": "MIT",
  "dependencies": {
    "chart.js": "^4.5.1",
    "lz-string": "^1.5.0",
    "sentiment": "^5.0.2"
  },
  "devDependencies": {
    "@types/sentiment": "^5.0.4",
    "@typescript-eslint/eslint-plugin": "^8.53.0",
    "@vitest/coverage-v8": "^4.0.17",
    "esbuild": "^0.27.2",
    "eslint": "^9.39.2",
    "eslint-config-prettier": "^10.0.1",
    "eslint-plugin-prettier": "^5.2.2",
    "jsdom": "^25.0.0",
    "prettier": "^3.8.1",
    "typescript": "^5.9.0",
    "typescript-eslint": "^8.54.0",
    "vitest": "^4.0.17"
  }
}
```

**Step 2: Install dependencies**

Run: `npm install`

Expected: Dependencies install without errors, `node_modules/` directory created

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: initialize project with dependencies

- Add Chart.js 4.5 for visualization
- Add Sentiment 5.0 for sentiment analysis
- Add lz-string 1.5 for URL compression
- Add TypeScript 5.9 with strict mode
- Add Vitest 4 with 95% coverage target
- Add ESLint 9 + Prettier 3 for code quality
- Add esbuild 0.27 for bundling

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create TypeScript configuration with strict mode

**Files:**
- Create: `tsconfig.json`

**Step 1: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "lib": ["ES2020", "DOM"],
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

**Step 2: Verify TypeScript configuration**

Run: `npx tsc --showConfig`

Expected: Configuration displays without errors, shows strict mode enabled

**Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore: configure TypeScript with strict mode

- ES2020 target for modern JavaScript features
- Bundler module resolution for esbuild compatibility
- Strict mode enabled with all safety checks
- Source maps for debugging

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Create Vitest configuration with 95% coverage thresholds

**Files:**
- Create: `vitest.config.ts`

**Step 1: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.config.ts',
        'scripts/',
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
```

**Step 2: Verify Vitest configuration**

Run: `npx vitest --version`

Expected: Displays Vitest version (4.0.17 or similar)

**Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: configure Vitest with 95% coverage thresholds

- jsdom environment for browser API testing
- v8 coverage provider for speed and accuracy
- 95% thresholds across all metrics (bluesky-universe standard)
- Exclude config files and test files from coverage

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Create Prettier configuration

**Files:**
- Create: `.prettierrc`

**Step 1: Create .prettierrc**

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

**Step 2: Verify Prettier works**

Run: `npx prettier --version`

Expected: Displays Prettier version (3.8.1 or similar)

**Step 3: Commit**

```bash
git add .prettierrc
git commit -m "chore: configure Prettier for code formatting

- Single quotes for strings
- 100 character line width
- Trailing commas for ES5 compatibility
- LF line endings for cross-platform consistency

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Create ESLint configuration with flat config

**Files:**
- Create: `eslint.config.mjs`

**Step 1: Create eslint.config.mjs**

```javascript
// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  }
);
```

**Step 2: Verify ESLint configuration**

Run: `npx eslint --version`

Expected: Displays ESLint version (9.39.2 or similar)

**Step 3: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore: configure ESLint with TypeScript support

- ESLint 9 flat config format
- typescript-eslint recommended rules
- Prettier integration to avoid conflicts
- Allow underscore-prefixed unused variables
- Prohibit explicit any types

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Create esbuild bundling script

**Files:**
- Create: `scripts/bundle.js`

**Step 1: Create scripts directory and bundle.js**

```javascript
import esbuild from 'esbuild';
import { existsSync, mkdirSync } from 'fs';

// Ensure dist directory exists
if (!existsSync('dist')) {
  mkdirSync('dist', { recursive: true });
}

// Build configuration
const buildOptions = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  platform: 'browser',
  target: 'es2020',
  format: 'esm',
  sourcemap: true,
  minify: process.env.NODE_ENV === 'production',
  loader: {
    '.ts': 'ts',
  },
};

try {
  await esbuild.build(buildOptions);
  console.log('✓ Build completed successfully');
} catch (error) {
  console.error('✗ Build failed:', error);
  process.exit(1);
}
```

**Step 2: Verify build script syntax**

Run: `node --check scripts/bundle.js`

Expected: No syntax errors reported

**Step 3: Commit**

```bash
git add scripts/bundle.js
git commit -m "chore: add esbuild bundling script

- Bundle TypeScript to single ES module
- ES2020 target for modern browsers
- Source maps for debugging
- Minify in production mode
- Auto-create dist directory

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Create basic HTML structure

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`

**Step 1: Create public directory and index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Analyze Bluesky threads and tally media mentions" />

    <!-- Open Graph meta tags (for Phase 7) -->
    <meta property="og:title" content="Starcounter - Bluesky Post Analyzer" />
    <meta property="og:description" content="Analyze Bluesky threads and tally media mentions" />
    <meta property="og:type" content="website" />

    <title>Starcounter - Bluesky Post Analyzer</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header>
      <h1>Starcounter</h1>
      <p>Analyze Bluesky threads and tally media mentions</p>
    </header>

    <main>
      <section id="input-section">
        <form id="post-form">
          <label for="post-url">Bluesky Post URL:</label>
          <input
            type="url"
            id="post-url"
            name="post-url"
            placeholder="https://bsky.app/profile/username/post/..."
            required
          />
          <button type="submit">Analyze</button>
        </form>
      </section>

      <section id="progress-section" style="display: none;">
        <div id="progress-bar">
          <div id="progress-fill"></div>
        </div>
        <p id="progress-text">Fetching thread...</p>
        <button id="cancel-button">Cancel</button>
      </section>

      <section id="results-section" style="display: none;">
        <h2>Results</h2>
        <div id="chart-container">
          <canvas id="results-chart"></canvas>
        </div>
        <div id="results-table"></div>
        <button id="share-button">Share Results</button>
      </section>
    </main>

    <footer>
      <p>Free and open source. No tracking. No data storage.</p>
    </footer>

    <script type="module" src="../dist/bundle.js"></script>
  </body>
</html>
```

**Step 2: Create public/styles.css**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell,
    sans-serif;
  line-height: 1.6;
  color: #333;
  background-color: #f5f5f5;
  padding: 20px;
}

header {
  text-align: center;
  margin-bottom: 2rem;
}

header h1 {
  font-size: 2.5rem;
  color: #1a73e8;
  margin-bottom: 0.5rem;
}

header p {
  font-size: 1.1rem;
  color: #666;
}

main {
  max-width: 800px;
  margin: 0 auto;
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

section {
  margin-bottom: 2rem;
}

#input-section label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
}

#input-section input {
  width: 100%;
  padding: 0.75rem;
  font-size: 1rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-bottom: 1rem;
}

button {
  background-color: #1a73e8;
  color: white;
  padding: 0.75rem 1.5rem;
  font-size: 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s;
}

button:hover {
  background-color: #1557b0;
}

#cancel-button {
  background-color: #dc3545;
}

#cancel-button:hover {
  background-color: #c82333;
}

#progress-bar {
  width: 100%;
  height: 30px;
  background-color: #e0e0e0;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 1rem;
}

#progress-fill {
  height: 100%;
  background-color: #1a73e8;
  width: 0%;
  transition: width 0.3s ease;
}

#progress-text {
  text-align: center;
  margin-bottom: 1rem;
  color: #666;
}

#chart-container {
  margin: 2rem 0;
  height: 400px;
}

footer {
  text-align: center;
  margin-top: 2rem;
  color: #999;
  font-size: 0.9rem;
}
```

**Step 3: Verify HTML structure**

Run: `cat public/index.html | head -20`

Expected: HTML displays correctly with proper DOCTYPE and meta tags

**Step 4: Commit**

```bash
git add public/index.html public/styles.css
git commit -m "chore: create basic HTML structure and styles

- Form for Bluesky post URL input
- Progress bar section (hidden by default)
- Results section with chart container (hidden by default)
- Responsive CSS with modern styling
- Open Graph meta tags for social sharing (Phase 7)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Create placeholder main.ts entry point

**Files:**
- Create: `src/main.ts`

**Step 1: Create src directory and main.ts**

```typescript
// Starcounter - Bluesky Post Analyzer
// Main entry point

console.log('Starcounter initialized');

// Phase 2 will implement Bluesky API client
// Phase 3 will implement thread builder and mention extraction
// Phase 4 will implement smart counting logic
// Phase 5 will implement validation APIs
// Phase 6 will implement UI interactions
// Phase 7 will implement URL sharing
// Phase 8 will implement advanced sentiment analysis
```

**Step 2: Test build pipeline**

Run: `npm run build`

Expected: Build completes successfully, creates `dist/bundle.js`

**Step 3: Verify bundle was created**

Run: `ls -lh dist/bundle.js`

Expected: File exists and is non-zero size

**Step 4: Commit**

```bash
git add src/main.ts
git commit -m "chore: add placeholder main.ts entry point

- Minimal TypeScript entry point for build verification
- Confirms build pipeline works end-to-end
- Ready for Phase 2 implementation

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: Verify complete project setup

**Files:**
- Verify: All configuration files
- Verify: Build pipeline
- Verify: Code quality tools

**Step 1: Run type checking**

Run: `npm run type-check`

Expected: Type checking passes with no errors

**Step 2: Run linting**

Run: `npm run lint`

Expected: No linting errors (placeholder code is clean)

**Step 3: Run formatting check**

Run: `npm run format:check`

Expected: All files are properly formatted

**Step 4: Run tests (will have none yet)**

Run: `npm test`

Expected: "No test files found" (this is expected for Phase 1)

**Step 5: Run full validation**

Run: `npm run validate`

Expected: All checks pass (format, lint, type-check complete successfully)

**Step 6: Verify file structure**

Run: `find . -type f -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./dist/*" | sort`

Expected output structure:
```
./.gitignore
./.prettierrc
./docs/design-plans/2026-02-04-bluesky-post-analyzer.md
./docs/implementation-plans/2026-02-04-bluesky-post-analyzer/phase_01.md
./eslint.config.mjs
./package-lock.json
./package.json
./public/index.html
./public/styles.css
./scripts/bundle.js
./src/main.ts
./tsconfig.json
./vitest.config.ts
```

**Step 7: Final commit if any fixes were needed**

If any formatting or linting issues were fixed:

```bash
git add -A
git commit -m "chore: fix formatting and linting issues

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

Otherwise: No commit needed
<!-- END_TASK_9 -->

---

## Phase 1 Complete

**Deliverables:**
- ✓ package.json with all dependencies (Chart.js, Sentiment, lz-string, TypeScript, Vitest, esbuild, ESLint, Prettier)
- ✓ tsconfig.json with strict mode and ES2020 target
- ✓ vitest.config.ts with jsdom environment and 95% coverage thresholds
- ✓ .prettierrc for consistent code formatting
- ✓ eslint.config.mjs with TypeScript support and flat config
- ✓ scripts/bundle.js for esbuild bundling
- ✓ public/index.html with form, progress bar, and results sections
- ✓ public/styles.css with responsive styling
- ✓ src/main.ts placeholder entry point
- ✓ All validation checks pass (type-check, lint, format)

**Verification:**
- `npm run build` succeeds and produces dist/bundle.js
- `npm run validate` passes all checks
- Project structure matches design plan specifications

**Next Phase:** Phase 2 will implement the Bluesky AT Protocol client with rate limiting
