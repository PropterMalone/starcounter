/**
 * Progress tracker for analysis pipeline
 * Emits events for each stage and monitors for stalls via heartbeat
 */

/**
 * Type-safe mapping of event names to their data payloads.
 * Each event has a specific data shape that TypeScript enforces.
 */
export type ProgressEventData = {
  fetching: { fetched: number; total: number };
  extracting: Record<string, never>;
  counting: Record<string, never>;
  validating: { validated: number; total: number };
  complete: { mentionCounts: unknown[] };
  error: { error: Error };
};

export type ProgressEvent = keyof ProgressEventData;

/**
 * @deprecated Use ProgressEventData instead for type-safe access
 */
export type ProgressData = {
  [K in ProgressEvent]?: ProgressEventData[K];
};

/**
 * Type-safe event listener that receives correctly typed data
 */
type TypedEventListener<K extends ProgressEvent> = (data: ProgressEventData[K]) => void;

/**
 * Internal storage type - stores listeners with unknown data for flexibility
 */
type StoredListener = (data: unknown) => void;

export class ProgressTracker {
  private listeners: Map<ProgressEvent, StoredListener[]> = new Map();
  private lastEventTime: number = Date.now();
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Register a type-safe event listener.
   * The listener receives correctly typed data for the specific event.
   */
  on<K extends ProgressEvent>(event: K, listener: TypedEventListener<K>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }

    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      // Cast to StoredListener for internal storage
      eventListeners.push(listener as StoredListener);
    }
  }

  /**
   * Remove an event listener
   */
  off<K extends ProgressEvent>(event: K, listener: TypedEventListener<K>): void {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) {
      return;
    }

    const index = eventListeners.indexOf(listener as StoredListener);
    if (index !== -1) {
      eventListeners.splice(index, 1);
    }
  }

  /**
   * Emit an event with type-safe data.
   * TypeScript enforces that the data matches the event's expected shape.
   */
  emit<K extends ProgressEvent>(event: K, data: ProgressEventData[K]): void {
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
