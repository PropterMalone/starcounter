// pattern: Imperative Shell
// This file runs in a Web Worker context

import { TransformersAnalyzer } from '../lib/transformers-analyzer';

const analyzer = new TransformersAnalyzer();

type WorkerRequest = {
  id: number;
  text: string;
};

/**
 * Handle incoming messages from the main thread.
 * Each message contains an id and text to analyze.
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, text } = event.data;

  // Initialize model on first request if needed
  if (!analyzer.isReady() && !analyzer.isLoading()) {
    self.postMessage({ type: 'model-loading' });

    try {
      await analyzer.initialize();
      self.postMessage({ type: 'model-loaded' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load model';
      self.postMessage({ id, error: message });
      return;
    }
  }

  try {
    const result = await analyzer.analyze(text);
    self.postMessage({ id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Inference failed';
    self.postMessage({ id, error: message });
  }
};

// Signal that the worker is ready to receive messages
self.postMessage({ type: 'worker-ready' });
