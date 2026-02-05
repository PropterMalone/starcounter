/**
 * Progress bar component for visualizing analysis progress
 * Updates bar width, text, and stage-specific messages
 */

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
   * Update for fetching stage
   */
  updateFetching(fetched: number, total: number): void {
    this.setText('Fetching posts...');
    this.setDetails(`Fetched ${fetched} of ${total} posts`);

    // Progress: 0-80% during fetching (leave room for other stages)
    const progress = total > 0 ? (fetched / total) * 80 : 0;
    this.setProgress(progress);
  }

  /**
   * Update for extracting stage
   */
  updateExtracting(): void {
    this.setText('Extracting mentions...');
    this.setDetails('');
    this.setProgress(80);
  }

  /**
   * Update for counting stage
   */
  updateCounting(): void {
    this.setText('Counting mentions...');
    this.setDetails('');
    this.setProgress(85);
  }

  /**
   * Update for validating stage
   */
  updateValidating(validated: number, total: number): void {
    this.setText('Validating mentions...');
    this.setDetails(`Validated ${validated} of ${total} mentions`);

    // Progress: 85-95% during validation
    const progress = total > 0 ? 85 + (validated / total) * 10 : 85;
    this.setProgress(progress);
  }

  /**
   * Update for complete stage
   */
  updateComplete(mentionCount: number): void {
    this.setText('Analysis complete!');
    this.setDetails(`Found ${mentionCount} mention${mentionCount === 1 ? '' : 's'}`);
    this.setProgress(100);
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.setProgress(0);
    this.setText('');
    this.setDetails('');
  }
}
