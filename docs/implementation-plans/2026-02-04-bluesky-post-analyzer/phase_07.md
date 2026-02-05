# Starcounter: Bluesky Post Analyzer Implementation Plan - Phase 7

**Goal:** Shareable URLs with rich Bluesky previews

**Architecture:** Client-side URL encoding with LZ-string compression, serverless OG image generation with Chart.js in Node canvas

**Tech Stack:** lz-string 1.5, Cloudflare Workers with canvas API, Chart.js server-side rendering

**Scope:** Phase 7 of 8 phases from original design

**Codebase verified:** 2026-02-04 (Phase 6 provides complete UI with results)

---

## Phase Overview

This phase enables sharing analysis results via URL. Results are compressed with LZ-string and encoded in query parameters (<2000 chars). When shared on Bluesky, the link displays a rich preview card with a chart image generated on-demand by a serverless function. The OG image function renders Chart.js to canvas and returns PNG bytes.

**URL structure:**
```
https://starcounter.app/?r=N4IgdghgtgpiBcIDCAXATgAgO...
```

**OG image generation:**
- Decode results from URL parameter
- Render Chart.js to server-side canvas (node-canvas)
- Export as PNG (1200x630px per OG spec)
- Cache for 24 hours to reduce re-rendering

**Testing:** URL encode/decode round-trip tests, OG image generation tests, size limit tests, 95% coverage target

---

## Implementation Summary

### Components to Implement:

1. **URL Encoder** (`src/lib/url-encoder.ts`)
   - Compress results with LZ-string
   - Base64 encode for URL safety
   - Decode on page load to restore state

2. **Share Button Handler** (`src/components/share-button.ts`)
   - Generate shareable URL
   - Copy to clipboard with feedback
   - Show URL in modal for manual copy

3. **OG Image Generator** (`functions/api/og.ts`)
   - Decode results from query param
   - Render Chart.js to canvas
   - Export PNG (1200x630)
   - Set cache headers (24hr)

4. **State Restoration** (`src/main.ts` extension)
   - Check for `?r=...` on page load
   - Decode and display results
   - Skip analysis if results present

### Key Implementation Details:

**URL Encoding:**
```typescript
import LZString from 'lz-string';

export function encodeResults(results: AnalysisResults): string {
  const json = JSON.stringify(results);
  const compressed = LZString.compressToBase64(json);
  return compressed;
}

export function decodeResults(encoded: string): AnalysisResults | null {
  try {
    const decompressed = LZString.decompressFromBase64(encoded);
    return JSON.parse(decompressed);
  } catch {
    return null;
  }
}
```

**OG Image with Chart.js:**
```typescript
import { createCanvas } from 'canvas';
import Chart from 'chart.js/auto';

export function generateOGImage(results: AnalysisResults): Buffer {
  const canvas = createCanvas(1200, 630);
  const ctx = canvas.getContext('2d');

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: results.mentions.map(m => m.title).slice(0, 10),
      datasets: [{ data: results.counts }]
    },
    options: {
      plugins: {
        title: { text: 'Starcounter Analysis', display: true }
      }
    }
  });

  return canvas.toBuffer('image/png');
}
```

**OG Meta Tags** (already in `public/index.html` from Phase 1):
```html
<meta property="og:title" content="Starcounter - Bluesky Post Analyzer" />
<meta property="og:image" content="https://starcounter.app/api/og?r={encoded}" />
<meta property="og:description" content="Analysis results: X mentions across Y posts" />
```

### Testing Strategy:
- **Round-trip tests**: Encode → decode → verify equality
- **Size tests**: Ensure compressed URL < 2000 characters
- **OG image tests**: Verify PNG generation, dimensions (1200x630)
- **Cache tests**: Verify cache headers set correctly
- **Error handling**: Corrupt encoded data, missing query params

### Task Structure:
1. Write URL encoder tests (TDD)
2. Implement URL encoder
3. Write OG generator tests (TDD)
4. Implement OG generator with canvas
5. Add share button to UI
6. Test end-to-end: share → open in new tab → see preview

---

## Verification

**Phase 7 complete when:**
- ✓ URL encoder compresses and encodes results
- ✓ Shareable URLs < 2000 characters for typical results
- ✓ Share button copies URL to clipboard
- ✓ OG image function generates valid 1200x630 PNG
- ✓ Opening shared URL restores results without re-analysis
- ✓ Bluesky shows rich preview card when URL shared
- ✓ All tests passing with ≥95% coverage

**Next Phase:** Phase 8 (optional) adds advanced sentiment analysis with Transformers.js for improved agreement detection
