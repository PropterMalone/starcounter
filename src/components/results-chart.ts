import Chart from 'chart.js/auto';
import type { MentionCount } from '../types';

/**
 * Results chart component using Chart.js
 * Renders bar chart with top mentions and supports drill-down clicks
 */

export class ResultsChart {
  private chart: Chart | null = null;
  private clickCallback: ((mention: string, posts: unknown[]) => void) | null = null;
  private mentionData: MentionCount[] = [];

  constructor(private canvas: HTMLCanvasElement) {}

  /**
   * Render chart with mention count data
   * @param mentionCounts - Array of mentions with counts and posts
   */
  render(mentionCounts: MentionCount[]): void {
    // Destroy existing chart
    if (this.chart) {
      this.chart.destroy();
    }

    // Store data for click handling
    this.mentionData = mentionCounts;

    // Sort by count descending and take top 20
    const sortedCounts = [...mentionCounts]
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // Prepare chart data
    const labels = sortedCounts.map((item) => item.mention);
    const data = sortedCounts.map((item) => item.count);

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
            backgroundColor: 'rgba(26, 115, 232, 0.8)',
            borderColor: 'rgba(26, 115, 232, 1)',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (event, elements) => {
          if (elements.length > 0 && this.clickCallback) {
            const index = elements[0].index;
            const mention = sortedCounts[index].mention;
            const posts = sortedCounts[index].posts;

            this.clickCallback(mention, posts);
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0,
            },
          },
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const count = context.parsed.y;
                return `${count} mention${count === 1 ? '' : 's'}`;
              },
            },
          },
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
