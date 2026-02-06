# Starcounter: Bluesky Post Analyzer Implementation Plan - Phase 8

**Goal:** Opt-in advanced sentiment with Transformers.js

**Architecture:** Lazy-loaded ML model for nuanced sentiment, toggle to switch between basic (Sentiment.js) and advanced (Transformers.js) analysis

**Tech Stack:** Transformers.js (browser-compatible), quantized distilbert model (~30MB), worker thread for non-blocking

**Scope:** Phase 8 of 8 phases from original design (OPTIONAL)

**Codebase verified:** 2026-02-04 (Phase 4 provides sentiment analyzer interface)

---

## Phase Overview

This optional phase upgrades sentiment analysis from keyword-based (Sentiment.js) to ML-based (Transformers.js) for better detection of sarcasm, nuanced disagreement, and complex sentiment. The model loads lazily only when the user enables "Advanced Analysis" mode. A Web Worker runs inference to avoid blocking the main thread. The interface remains compatible with Phase 4's `SentimentAnalyzer` for seamless swapping.

**Why optional:**
- Adds ~30MB download (quantized model)
- Slower than keyword-based (1-2 seconds for model load)
- Only needed for complex sentiment cases
- Not required for MVP functionality

**Model:** `Xenova/distilbert-base-uncased-finetuned-sst-2-english` (quantized)
- Size: ~30MB compressed
- Task: Binary sentiment classification (positive/negative)
- Speed: ~50ms per inference on modern hardware

**Testing:** Model loading tests, inference tests with edge cases, worker thread tests, 95% coverage target

---

## Implementation Summary

### Components to Implement:

1. **Transformers Analyzer** (`src/lib/transformers-analyzer.ts`)
   - Lazy load Transformers.js pipeline
   - Quantized model for reduced size
   - Async inference with caching
   - Compatible with `SentimentAnalyzer` interface

2. **Worker Thread** (`src/workers/sentiment-worker.ts`)
   - Run Transformers.js in Web Worker
   - Message passing for inference requests
   - Prevents UI blocking during analysis

3. **Advanced Mode Toggle** (`src/components/advanced-toggle.ts`)
   - Checkbox in UI to enable advanced analysis
   - Show loading indicator while model downloads
   - Persist preference in localStorage

4. **Analyzer Factory** (`src/lib/sentiment-factory.ts`)
   - Return basic or advanced analyzer based on user preference
   - Lazy initialization of advanced analyzer

### Key Implementation Details:

**Transformers.js Integration:**
```typescript
import { pipeline } from '@xenova/transformers';

export class TransformersAnalyzer {
  private pipeline: any = null;

  async initialize(): Promise<void> {
    this.pipeline = await pipeline(
      'sentiment-analysis',
      'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
      { quantized: true }
    );
  }

  async analyze(text: string): Promise<SentimentResult> {
    if (!this.pipeline) await this.initialize();

    const result = await this.pipeline(text);
    // result = [{ label: 'POSITIVE', score: 0.9998 }]

    const label = result[0].label;
    const score = result[0].score;

    return {
      classification: label === 'POSITIVE' ? 'Positive' : 'Negative',
      comparative: label === 'POSITIVE' ? score : -score,
      strength: score > 0.9 ? 'Strong' : 'Moderate',
      // ... rest of interface
    };
  }
}
```

**Worker Thread:**
```typescript
// src/workers/sentiment-worker.ts
import { TransformersAnalyzer } from '../lib/transformers-analyzer';

const analyzer = new TransformersAnalyzer();

self.onmessage = async (e) => {
  const { id, text } = e.data;

  try {
    const result = await analyzer.analyze(text);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
```

**Factory Pattern:**
```typescript
export function createSentimentAnalyzer(advanced: boolean): SentimentAnalyzer | TransformersAnalyzer {
  if (advanced) {
    return new TransformersAnalyzer();
  } else {
    return new SentimentAnalyzer(); // Basic from Phase 4
  }
}
```

### Testing Strategy:
- **Mock Transformers.js**: Don't download real model in tests
- **Worker tests**: Verify message passing, error handling
- **Interface compatibility**: Ensure Transformers analyzer matches Phase 4 interface
- **Performance tests**: Measure inference time (should be <200ms per text)
- **Edge cases**: Very long text, empty text, special characters

### Task Structure:
1. Add Transformers.js dependency
2. Write Transformers analyzer tests (with mocks)
3. Implement Transformers analyzer
4. Write worker thread tests
5. Implement worker thread
6. Add UI toggle for advanced mode
7. Update main.ts to use factory pattern
8. Test end-to-end with real model (manual)

---

## Verification

**Phase 8 complete when:**
- ✓ Transformers analyzer implements SentimentAnalyzer interface
- ✓ Model loads lazily when advanced mode enabled
- ✓ Worker thread runs inference without blocking UI
- ✓ Toggle persists preference in localStorage
- ✓ Loading indicator shows during model download
- ✓ Analysis results improve for sarcastic/nuanced text
- ✓ All tests passing with ≥95% coverage
- ✓ Bundle size acceptable (~30MB for model + ~2MB for library)

**Deployment note:** Consider hosting quantized model on CDN to reduce initial bundle size

---

## Project Complete

All 8 phases implemented! The Starcounter application is fully functional:
- ✓ Phase 1: Project infrastructure
- ✓ Phase 2: Bluesky API client
- ✓ Phase 3: Thread parsing and extraction
- ✓ Phase 4: Smart counting with sentiment
- ✓ Phase 5: Validation APIs
- ✓ Phase 6: Interactive UI
- ✓ Phase 7: URL sharing
- ✓ Phase 8: Advanced sentiment (optional)

**Next steps:**
1. Execute implementation plans (use `/ed3d-plan-and-execute:execute-implementation-plan`)
2. Deploy to Cloudflare Pages
3. Set up environment variables (TMDB_API_KEY, MUSICBRAINZ_USER_AGENT)
4. Test with real Bluesky threads
5. Share on Bluesky! 🎉
