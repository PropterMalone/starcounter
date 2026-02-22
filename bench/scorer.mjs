/**
 * Scoring engine: compares algorithm predictions against gold labels.
 *
 * Scoring approach:
 * - For each post with gold labels, check if the algorithm found the right titles.
 * - A "match" means the algorithm predicted a title that matches a gold label
 *   (case-insensitive, with fuzzy normalization for common variants).
 * - Precision = correct predictions / total predictions
 * - Recall = correct predictions / total gold labels
 * - F1 = harmonic mean of precision and recall
 *
 * We score at the (post, title) pair level, not just post level.
 */

/**
 * Normalize a title for comparison.
 * Strips "The", punctuation, extra spaces; lowercases.
 */
export function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/['']/g, "'")
    .replace(/[^\w\s'&]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if two titles match (fuzzy).
 * Handles common abbreviations and variants.
 */
export function titlesMatch(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);

  // Exact match after normalization
  if (na === nb) return true;

  // One contains the other (for abbreviation matching)
  // e.g., "M&C" should not match "Master and Commander" this way,
  // but "Hunt for Red October" should match "The Hunt for Red October"
  if (na.length > 5 && nb.length > 5) {
    if (na.includes(nb) || nb.includes(na)) return true;
  }

  return false;
}

/**
 * Score algorithm results against gold labels.
 *
 * @param {Map<string, string[]>} predictions - Map of post URI -> predicted titles
 * @param {Map<string, import('./types.mjs').GoldLabel>} goldLabels - Map of post URI -> gold label
 * @param {string} algorithmName
 * @returns {import('./types.mjs').BenchmarkScore}
 */
export function score(predictions, goldLabels, algorithmName) {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let postsCorrect = 0;
  let postsMissed = 0;
  let postsLabeled = 0;

  // Per-title tracking
  const titleStats = new Map(); // title -> {tp, fp, fn}

  function getTitleStats(title) {
    const norm = normalizeTitle(title);
    if (!titleStats.has(norm)) {
      titleStats.set(norm, { title, tp: 0, fp: 0, fn: 0 });
    }
    return titleStats.get(norm);
  }

  for (const [uri, gold] of goldLabels) {
    if (!gold.onTopic) continue; // Skip off-topic posts (no penalty for ignoring them)

    const predicted = predictions.get(uri) || [];
    const goldTitles = gold.topics;

    if (predicted.length > 0) postsLabeled++;

    // Track which gold titles were found
    const goldFound = new Set();
    const predUsed = new Set();

    // Match predictions to gold titles
    for (const pred of predicted) {
      let matched = false;
      for (const gt of goldTitles) {
        if (!goldFound.has(gt) && titlesMatch(pred, gt)) {
          goldFound.add(gt);
          predUsed.add(pred);
          truePositives++;
          getTitleStats(gt).tp++;
          matched = true;
          break;
        }
      }
      if (!matched) {
        falsePositives++;
        getTitleStats(pred).fp++;
      }
    }

    // Gold titles not found = false negatives
    for (const gt of goldTitles) {
      if (!goldFound.has(gt)) {
        falseNegatives++;
        getTitleStats(gt).fn++;
      }
    }

    // Post-level tracking
    if (goldFound.size === goldTitles.length && goldFound.size > 0) {
      postsCorrect++;
    } else if (predicted.length === 0 && goldTitles.length > 0) {
      postsMissed++;
    }
  }

  const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
  const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // Build per-title breakdown (top 20 by total mentions)
  const perTitle = {};
  const sortedTitles = [...titleStats.entries()]
    .sort((a, b) => (b[1].tp + b[1].fn) - (a[1].tp + a[1].fn))
    .slice(0, 30);

  for (const [norm, stats] of sortedTitles) {
    const p = stats.tp + stats.fp > 0 ? stats.tp / (stats.tp + stats.fp) : 0;
    const r = stats.tp + stats.fn > 0 ? stats.tp / (stats.tp + stats.fn) : 0;
    const f = p + r > 0 ? (2 * p * r) / (p + r) : 0;
    perTitle[stats.title] = {
      precision: Math.round(p * 100),
      recall: Math.round(r * 100),
      f1: Math.round(f * 100),
      tp: stats.tp,
      fp: stats.fp,
      fn: stats.fn,
    };
  }

  return {
    algorithm: algorithmName,
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: Math.round(f1 * 1000) / 1000,
    truePositives,
    falsePositives,
    falseNegatives,
    postsLabeled,
    postsCorrect,
    postsMissed,
    perTitle,
  };
}

/**
 * Print a comparison table of multiple benchmark scores.
 */
export function printComparison(scores) {
  console.log('\n' + '='.repeat(80));
  console.log('BENCHMARK RESULTS');
  console.log('='.repeat(80));

  // Summary table
  console.log('\n  Algorithm                    Precision  Recall  F1     TP    FP    FN   Missed');
  console.log('  ' + '-'.repeat(85));
  for (const s of scores) {
    console.log(
      `  ${s.algorithm.padEnd(30)} ${String(s.precision).padStart(6)}   ${String(s.recall).padStart(6)}  ${String(s.f1).padStart(5)}  ${String(s.truePositives).padStart(5)} ${String(s.falsePositives).padStart(5)} ${String(s.falseNegatives).padStart(5)}  ${String(s.postsMissed).padStart(6)}`
    );
  }

  // Per-title breakdown for the best algorithm
  const best = scores.reduce((a, b) => (a.f1 > b.f1 ? a : b));
  console.log(`\nPer-title breakdown (best: ${best.algorithm}):`);
  console.log('  Title                                  P%    R%    F1%   TP   FP   FN');
  console.log('  ' + '-'.repeat(75));
  for (const [title, stats] of Object.entries(best.perTitle || {})) {
    console.log(
      `  ${title.slice(0, 40).padEnd(40)} ${String(stats.precision).padStart(4)}  ${String(stats.recall).padStart(4)}  ${String(stats.f1).padStart(4)}  ${String(stats.tp).padStart(4)} ${String(stats.fp).padStart(4)} ${String(stats.fn).padStart(4)}`
    );
  }
}
