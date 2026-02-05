/**
 * Progress tracker for analysis pipeline
 * Emits events for each stage and monitors for stalls via heartbeat
 */

export type ProgressEvent =
  | 'fetching'
  | 'extracting'
  | 'counting'
  | 'validating'
  | 'complete'
  | 'error';

export type ProgressData = {
  fetching?: { fetched: number; total: number };
  extracting?: Record<string, never>;
  counting?: Record<string, never>;
  validating?: { validated: number; total: number };
  complete?: unknown;
  error?: { error: Error };
};

type EventListener = (data: unknown) => void;

export class ProgressTracker {
  private listeners: Map<ProgressEvent, EventListener[]> = new Map();
  private lastEventTime: number = Date.now();
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Register an event listener
   */
  on(event: ProgressEvent, listener: EventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }

    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.push(listener);
    }
  }

  /**
   * Remove an event listener
   */
  off(event: ProgressEvent, listener: EventListener): void {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) {
      return;
    }

    const index = eventListeners.indexOf(listener);
    if (index !== -1) {
      eventListeners.splice(index, 1);
    }
  }

  /**
   * Emit an event with data
   */
  emit(event: ProgressEvent, data: unknown): void {
    this.lastEventTime = Date.now();

    const eventListeners = this.listeners.get(event);
    if (!eventListeners) {
      return;
    }

    for (const listener of eventListeners) {
      listener(data);
    }
  }

  /**
   * Start heartbeat monitoring to detect stalls
   * @param intervalMs - Check interval in milliseconds
   * @param onStall - Callback when stall is detected
   */
  startHeartbeat(intervalMs: number, onStall: () => void): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      const timeSinceLastEvent = Date.now() - this.lastEventTime;
      if (timeSinceLastEvent >= intervalMs) {
        onStall();
      }
    }, intervalMs);
  }

  /**
   * Stop heartbeat monitoring
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Reset tracker - remove all listeners and stop heartbeat
   */
  reset(): void {
    this.listeners.clear();
    this.stopHeartbeat();
    this.lastEventTime = Date.now();
  }
}
