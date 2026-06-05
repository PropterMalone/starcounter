import type { FetchStage } from '../lib/progress-tracker';

/**
 * Progress bar component for visualizing analysis progress
 * Updates bar width, text, and stage-specific messages
 */

// Each fetch stage maps to a progress range within 0-80%
const STAGE_PROGRESS: Record<FetchStage, { start: number; label: string }> = {
  thread: { start: 0, label: 'Fetching thread...' },
  truncated: { start: 15, label: 'Expanding truncated replies...' },
  quotes: { start: 25, label: 'Fetching quote threads...' },
  recursive: { start: 60, label: 'Fetching recursive quotes...' },
};

export class ProgressBar {
  constructor(
    private section: HTMLElement,
    private progressBar: HTMLElement,
    private progressText: HTMLElement,
    private progressDetails: HTMLElement
  ) {}

  /**
   * Show progress section
   */
  show(): void {
    this.section.style.display = 'block';
  }

  /**
   * Hide progress section
   */
  hide(): void {
    this.section.style.display = 'none';
  }

  /**
   * Set progress bar width (0-100)
   */
  setProgress(percent: number): void {
    const clamped = Math.max(0, Math.min(100, percent));
    this.progressBar.style.width = `${clamped}%`;
  }

  /**
   * Enable/disable indeterminate shimmer animation
   */
  setIndeterminate(indeterminate: boolean): void {
    if (indeterminate) {
      this.progressBar.classList.add('indeterminate');
    } else {
      this.progressBar.classList.remove('indeterminate');
    }
  }

  /**
   * Set progress text message
   */
  setText(text: string): void {
    this.progressText.textContent = text;
  }

  /**
   * Set progress details message
   */
  setDetails(details: string): void {
    this.progressDetails.textContent = details;
  }

  /**
   * Update for fetching stage — shows shimmer + post counter per sub-stage
   */
  updateFetching(fetched: number, stage: FetchStage): void {
    const stageInfo = STAGE_PROGRESS[stage];
    this.setIndeterminate(true);
    this.setText(stageInfo.label);
    this.setDetails(fetched > 0 ? `${fetched} posts found` : '');
    this.setProgress(stageInfo.start);
  }

  /**
   * Update for extracting stage
   */
  updateExtracting(): void {
    this.setIndeterminate(false);
    this.setText('Extracting mentions...');
    this.setDetails('');
    this.setProgress(80);
  }

  /**
   * Update for counting stage
   */
  updateCounting(): void {
    this.setIndeterminate(false);
    this.setText('Counting mentions...');
    this.setDetails('');
    this.setProgress(85);
  }

  /**
   * Update for validating stage - shows shimmer animation
   */
  updateValidating(validated: number, total: number): void {
    this.setText('Validating mentions...');
    this.setDetails(`Validated ${validated} of ${total} mentions`);

    // Show shimmer effect during validation (waiting on external APIs)
    if (validated === 0 && total > 0) {
      this.setIndeterminate(true);
    }

    // Progress: 85-95% during validation
    const progress = total > 0 ? 85 + (validated / total) * 10 : 85;
    this.setProgress(progress);
  }

  /**
   * Update for complete stage
   */
  updateComplete(mentionCount: number): void {
    this.setIndeterminate(false);
    this.setText('Analysis complete!');
    this.setDetails(`Found ${mentionCount} mention${mentionCount === 1 ? '' : 's'}`);
    this.setProgress(100);
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.setIndeterminate(false);
    this.setProgress(0);
    this.setText('');
    this.setDetails('');
  }
}
