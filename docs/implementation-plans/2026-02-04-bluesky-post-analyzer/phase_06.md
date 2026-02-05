# Starcounter: Bluesky Post Analyzer Implementation Plan - Phase 6

**Goal:** Interactive web interface with real-time progress and cancellation

**Architecture:** Event-driven UI components with progress tracking, Chart.js for visualization, drill-down modal for contributing posts

**Tech Stack:** Vanilla TypeScript, Chart.js 4.5, DOM manipulation, event emitters for progress

**Scope:** Phase 6 of 8 phases from original design

**Codebase verified:** 2026-02-04 (Phases 1-5 provide complete backend)

---

## Phase Overview

This phase connects all previous phases into a working UI. It orchestrates the analysis pipeline: URL input → thread fetching → mention extraction → counting → validation → chart display. Progress tracking with heartbeat detection prevents UI freeze. Cancellation support allows users to stop long-running analyses. Interactive charts enable drill-down to see which posts contributed to each mention's count.

**Pipeline stages:**
1. **Input validation** - Parse Bluesky post URL
2. **Thread fetching** - Recursive with progress (X of Y posts)
3. **Mention extraction** - Extract from all posts
4. **Smart counting** - Apply sentiment + novelty rules
5. **Validation** - Fuzzy match with TMDB/MusicBrainz (optional)
6. **Visualization** - Chart.js bar chart with drill-down

**Progress indicators:**
- Fetching: "Fetched 45/120 posts..."
- Extracting: "Extracting mentions..."
- Validating: "Validated 12/35 mentions..."
- Complete: "Analysis complete! 8 mentions found."

**Testing:** DOM tests with jsdom, event simulation, progress tracking tests, 95% coverage target

---

## Implementation Summary

Due to the UI-heavy nature of Phase 6, the implementation tasks follow this structure:

### Components to Implement:
1. **Input Form Handler** (`src/components/input-form.ts`) - URL validation, submit handling
2. **Progress Tracker** (`src/lib/progress-tracker.ts`) - Event emitter for progress updates, heartbeat detection
3. **Progress UI** (`src/components/progress-bar.ts`) - Visual progress bar + text updates
4. **Chart Renderer** (`src/components/results-chart.ts`) - Chart.js integration, click handlers
5. **Drill-Down Modal** (`src/components/drill-down.ts`) - Show contributing posts for a mention
6. **Main Orchestrator** (`src/main.ts`) - Tie everything together, manage pipeline

### Key Implementation Details:

**Progress Tracker Event System:**
```typescript
export class ProgressTracker extends EventEmitter {
  emit(stage: 'fetching' | 'extracting' | 'counting' | 'validating' | 'complete', data: any): void;
  onHeartbeat(callback: () => void): void; // Detect stalls
}
```

**Chart.js Integration:**
```typescript
import Chart from 'chart.js/auto';

const chart = new Chart(ctx, {
  type: 'bar',
  data: { labels: mentions, datasets: [{ data: counts }] },
  options: {
    onClick: (event, elements) => {
      // Show drill-down modal
    }
  }
});
```

**Pipeline Orchestration:**
```typescript
async function analyzePosts(url: string): Promise<void> {
  tracker.emit('fetching', { stage: 'start' });

  const thread = await blueskyClient.getPostThread(url);
  const tree = threadBuilder.buildTree(thread);

  tracker.emit('extracting', {});
  const mentions = mentionExtractor.extractMentions(tree.allPosts);

  tracker.emit('counting', {});
  const counts = counter.countMentions(mentions, tree);

  tracker.emit('validating', { total: mentions.length });
  const validated = await validationClient.validateMentions(mentions);

  tracker.emit('complete', { mentions: validated, counts });
}
```

### Testing Strategy:
- **Unit tests** for each component with mocked dependencies
- **Integration tests** for pipeline orchestration
- **DOM tests** using jsdom to verify UI updates
- **Progress event tests** to ensure all stages fire correctly
- **Cancellation tests** to verify AbortController usage

### Task Structure:
Each component follows TDD:
1. Write component test (failing)
2. Implement component
3. Verify tests pass
4. Check coverage ≥95%

### Barrel Export:
```typescript
// src/components/index.ts
export { InputForm } from './input-form';
export { ProgressBar } from './progress-bar';
export { ResultsChart } from './results-chart';
export { DrillDownModal } from './drill-down';
```

---

## Verification

**Phase 6 complete when:**
- ✓ All UI components implemented with tests
- ✓ Main orchestrator ties all phases together
- ✓ Progress tracking works with heartbeat detection
- ✓ Chart renders and drill-down modal shows posts
- ✓ Cancellation stops analysis mid-flight
- ✓ All tests passing with ≥95% coverage
- ✓ `npm run build` produces working bundle
- ✓ Can open `public/index.html` in browser and analyze a real Bluesky thread

**Next Phase:** Phase 7 will add URL sharing with LZ-string compression and OG image generation for Bluesky preview cards
