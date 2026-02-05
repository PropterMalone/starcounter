// pattern: Imperative Shell
import type { SentimentResult } from '../lib/sentiment-analyzer';

type WorkerMessage = { id: number; text: string } | { type: 'init' };

type WorkerResponse =
  | { id: number; result: SentimentResult }
  | { id: number; error: string }
  | { type: 'model-loading' }
  | { type: 'model-loaded' }
  | { type: 'progress'; progress: number };

type PendingRequest = {
  resolve: (result: SentimentResult) => void;
  reject: (error: Error) => void;
};

type ProgressCallback = (progress: number) => void;

/**
 * Client for communicating with the sentiment analysis Web Worker.
 * Provides async interface for sentiment analysis without blocking UI.
 */
export class SentimentWorkerClient {
  private worker: Worker;
  private pendingRequests: Map<number, PendingRequest> = new Map();
  private nextRequestId = 1;
  private modelReady = false;
  private modelLoading = false;
  private progressCallbacks: Array<ProgressCallback> = [];
  private terminated = false;

  constructor(worker: Worker) {
    this.worker = worker;
    this.setupListeners();
  }

  private setupListeners(): void {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.handleMessage(event.data);
    };

    this.worker.onerror = (event: ErrorEvent) => {
      this.handleError(event);
    };
  }

  private handleMessage(data: WorkerResponse): void {
    if ('type' in data) {
      switch (data.type) {
        case 'model-loading':
          this.modelLoading = true;
          break;
        case 'model-loaded':
          this.modelLoading = false;
          this.modelReady = true;
          break;
        case 'progress':
          this.notifyProgress(data.progress);
          break;
      }
      return;
    }

    const pending = this.pendingRequests.get(data.id);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(data.id);

    if ('error' in data) {
      pending.reject(new Error(data.error));
    } else {
      pending.resolve(data.result);
    }
  }

  private handleError(event: ErrorEvent): void {
    const error = new Error(event.message);

    // Reject all pending requests
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private notifyProgress(progress: number): void {
    for (const callback of this.progressCallbacks) {
      callback(progress);
    }
  }

  /**
   * Analyze text for sentiment using the worker.
   * Auto-initializes the model if needed.
   */
  async analyze(text: string): Promise<SentimentResult> {
    if (this.terminated) {
      return Promise.reject(new Error('Worker terminated'));
    }

    const id = this.nextRequestId++;

    return new Promise<SentimentResult>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.worker.postMessage({ id, text } as WorkerMessage);
    });
  }

  /**
   * Check if text expresses agreement.
   */
  async isAgreement(text: string): Promise<boolean> {
    const result = await this.analyze(text);
    return result.classification === 'Positive';
  }

  /**
   * Check if the model is ready for inference.
   */
  isReady(): boolean {
    return this.modelReady;
  }

  /**
   * Check if the model is currently loading.
   */
  isLoading(): boolean {
    return this.modelLoading;
  }

  /**
   * Register a callback for model download progress.
   */
  onProgress(callback: ProgressCallback): void {
    this.progressCallbacks.push(callback);
  }

  /**
   * Terminate the worker and reject all pending requests.
   */
  terminate(): void {
    this.terminated = true;

    // Reject all pending requests
    const error = new Error('Worker terminated');
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();

    this.worker.terminate();
  }
}

/**
 * Create a sentiment worker client with a new Worker instance.
 * The worker script path should point to the bundled worker file.
 */
export function createSentimentWorkerClient(workerUrl: string | URL): SentimentWorkerClient {
  const worker = new Worker(workerUrl, { type: 'module' });
  return new SentimentWorkerClient(worker);
}
