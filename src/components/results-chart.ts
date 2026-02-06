// Tree-shaken Chart.js imports - only include what we need for horizontal bar charts
import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
} from 'chart.js';
import type { MentionCount } from '../types';

// Register only the components we use
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

/**
 * Results chart component using Chart.js
 * Renders bar chart with top mentions and supports drill-down clicks
 */

const INITIAL_DISPLAY_COUNT = 20;
const EXPANDED_DISPLAY_COUNT = 50;

// Vibrant rainbow colors (repeating pattern)
const CHART_COLORS = [
  { bg: 'rgba(255, 99, 132, 0.8)', border: 'rgba(255, 99, 132, 1)' },   // Hot pink
  { bg: 'rgba(255, 127, 80, 0.8)', border: 'rgba(255, 127, 80, 1)' },   // Coral
  { bg: 'rgba(255, 159, 64, 0.8)', border: 'rgba(255, 159, 64, 1)' },   // Orange
  { bg: 'rgba(255, 193, 7, 0.8)', border: 'rgba(255, 193, 7, 1)' },     // Amber
  { bg: 'rgba(205, 220, 57, 0.8)', border: 'rgba(205, 220, 57, 1)' },   // Lime
  { bg: 'rgba(76, 175, 80, 0.8)', border: 'rgba(76, 175, 80, 1)' },     // Green
  { bg: 'rgba(0, 188, 212, 0.8)', border: 'rgba(0, 188, 212, 1)' },     // Cyan
  { bg: 'rgba(33, 150, 243, 0.8)', border: 'rgba(33, 150, 243, 1)' },   // Blue
  { bg: 'rgba(103, 58, 183, 0.8)', border: 'rgba(103, 58, 183, 1)' },   // Deep purple
  { bg: 'rgba(156, 39, 176, 0.8)', border: 'rgba(156, 39, 176, 1)' },   // Purple
];

/**
 * Generate colors for bars using repeating rainbow pattern
 */
function generateBarColors(count: number): { backgrounds: string[]; borders: string[] } {
  const backgrounds: string[] = [];
  const borders: string[] = [];

  for (let i = 0; i < count; i++) {
    // Cycle through colors repeatedly
    const colorIndex = i % CHART_COLORS.length;
    const color = CHART_COLORS[colorIndex] ?? CHART_COLORS[0];
    backgrounds.push(color.bg);
    borders.push(color.border);
  }

  return { backgrounds, borders };
}

export class ResultsChart {
  private chart: Chart | null = null;
  private clickCallback: ((mention: string, posts: unknown[]) => void) | null = null;
  private allMentionCounts: MentionCount[] = [];
  private isExpanded = false;
  private showMoreButton: HTMLButtonElement | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.setupShowMoreButton();
  }

  /**
   * Setup the "Show More" button below the chart
   */
  private setupShowMoreButton(): void {
    // Find or create the show more button container
    const chartContainer = this.canvas.closest('.chart-container');
    if (!chartContainer) return;

    const parent = chartContainer.parentElement;
    if (!parent) return;

    // Check if button already exists
    let button = parent.querySelector('.show-more-btn') as HTMLButtonElement | null;
    if (!button) {
      button = document.createElement('button');
      button.className = 'btn btn-secondary show-more-btn';
      button.style.marginTop = '1rem';
      button.style.display = 'none';
      parent.appendChild(button);
    }

    button.addEventListener('click', () => {
      this.toggleExpanded();
    });

    this.showMoreButton = button;
  }

  /**
   * Toggle between showing limited and expanded results
   */
  private toggleExpanded(): void {
    this.isExpanded = !this.isExpanded;
    this.renderChart();
    this.updateShowMoreButton();
  }

  /**
   * Update the show more button text and visibility
   */
  private updateShowMoreButton(): void {
    if (!this.showMoreButton) return;

    const totalCount = this.allMentionCounts.length;
    const _currentLimit = this.isExpanded ? EXPANDED_DISPLAY_COUNT : INITIAL_DISPLAY_COUNT;

    if (totalCount <= INITIAL_DISPLAY_COUNT) {
      // No need for button if we have fewer results than initial display
      this.showMoreButton.style.display = 'none';
    } else {
      this.showMoreButton.style.display = 'block';
      if (this.isExpanded) {
        this.showMoreButton.textContent = `Show Less (top ${INITIAL_DISPLAY_COUNT})`;
      } else {
        const moreCount = Math.min(totalCount, EXPANDED_DISPLAY_COUNT) - INITIAL_DISPLAY_COUNT;
        this.showMoreButton.textContent = `Show ${moreCount} More (${Math.min(totalCount, EXPANDED_DISPLAY_COUNT)} total)`;
      }
    }
  }

  /**
   * Render chart with mention count data
   * @param mentionCounts - Array of mentions with counts and posts
   */
  render(mentionCounts: MentionCount[]): void {
    // Store all data and reset expansion state
    this.allMentionCounts = [...mentionCounts].sort((a, b) => b.count - a.count);
    this.isExpanded = false;
    this.renderChart();
    this.updateShowMoreButton();
    this.updateAriaLabel();
  }

  /**
   * Update the canvas aria-label with a description of chart results
   * for screen reader accessibility
   */
  private updateAriaLabel(): void {
    const count = this.allMentionCounts.length;
    if (count === 0) {
      this.canvas.setAttribute('aria-label', 'No media mentions found');
      return;
    }

    const top = this.allMentionCounts[0];
    const topTitle = top?.mention ?? 'Unknown';
    const topCount = top?.count ?? 0;

    const description = `Bar chart showing ${count} media mention${count === 1 ? '' : 's'}. ${topTitle} leads with ${topCount} mention${topCount === 1 ? '' : 's'}.`;
    this.canvas.setAttribute('aria-label', description);
  }

  /**
   * Internal render method that uses current expansion state
   */
  private renderChart(): void {
    // Destroy existing chart
    if (this.chart) {
      this.chart.destroy();
    }

    const displayLimit = this.isExpanded ? EXPANDED_DISPLAY_COUNT : INITIAL_DISPLAY_COUNT;
    const sortedCounts = this.allMentionCounts.slice(0, displayLimit);

    // Adjust chart container height based on number of bars
    const chartContainer = this.canvas.closest('.chart-container') as HTMLElement | null;
    if (chartContainer) {
      const barHeight = 25; // pixels per bar
      const minHeight = 400;
      const calculatedHeight = Math.max(minHeight, sortedCounts.length * barHeight);
      chartContainer.style.height = `${calculatedHeight}px`;
    }

    // Prepare chart data
    const labels = sortedCounts.map((item) => item.mention);
    const data = sortedCounts.map((item) => item.count);

    // Generate gradient colors for bars
    const { backgrounds, borders } = generateBarColors(data.length);

    // Create chart
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Mention Count',
            data,
            backgroundColor: backgrounds,
            borderColor: borders,
            borderWidth: 1,
            borderRadius: 4,
            hoverBackgroundColor: backgrounds.map((c) => c.replace('0.8', '1')),
          },
        ],
      },
      options: {
        indexAxis: 'y', // Horizontal bars - easier to read labels
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_event, elements) => {
          if (elements.length > 0 && this.clickCallback) {
            const element = elements[0];
            if (element && typeof element.index === 'number') {
              const item = sortedCounts[element.index];
              if (item) {
                this.clickCallback(item.mention, item.posts);
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              precision: 0,
            },
            grid: {
              color: 'rgba(0, 0, 0, 0.05)',
            },
          },
          y: {
            ticks: {
              font: {
                size: 12,
              },
            },
            grid: {
              display: false,
            },
          },
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleFont: {
              size: 14,
              weight: 'bold',
            },
            bodyFont: {
              size: 13,
            },
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: (context) => {
                const count = context.parsed.x;
                return `${count} mention${count === 1 ? '' : 's'} — click for details`;
              },
            },
          },
        },
        animation: {
          duration: 500,
          easing: 'easeOutQuart',
        },
      },
    });
  }

  /**
   * Register click callback for bar clicks
   */
  onClick(callback: (mention: string, posts: unknown[]) => void): void {
    this.clickCallback = callback;
  }

  /**
   * Destroy chart instance
   */
  destroy(): void {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }
}
