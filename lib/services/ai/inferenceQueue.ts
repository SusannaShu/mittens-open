/**
 * InferenceQueue -- AsyncStorage-backed task queue for self-hosted inference.
 *
 * When the self-hosted endpoint is unreachable, tasks are queued here.
 * The user manually triggers processing when they know their server is available.
 * No background polling -- battery friendly.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = 'mittens_inference_queue';

export interface QueuedTask {
  id: string;
  createdAt: string;
  type: 'text' | 'photo';
  payload: {
    text?: string;
    photos?: string[];         // local file URIs (already saved to disk)
    base64Photos?: string[];   // base64 for cloud fallback
    caption?: string;
    photoTime?: string;
    replyTo?: { id: string; text: string };
  };
  messageId: string;           // ChatMessage ID in the UI (for updating)
  status: 'queued' | 'processing' | 'completed' | 'failed';
  error?: string;
  retryCount: number;
}

// In-memory cache to avoid AsyncStorage reads on every check
let cachedQueue: QueuedTask[] | null = null;

// Listener for queue changes (UI updates)
type QueueListener = (queue: QueuedTask[]) => void;
const listeners: QueueListener[] = [];

function notifyListeners(queue: QueuedTask[]) {
  listeners.forEach(fn => fn(queue));
}

export const InferenceQueue = {
  /** Subscribe to queue changes */
  addListener(fn: QueueListener): () => void {
    listeners.push(fn);
    return () => {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  },

  /** Load queue from storage */
  async load(): Promise<QueuedTask[]> {
    if (cachedQueue) return cachedQueue;
    try {
      const raw = await AsyncStorage.getItem(QUEUE_KEY);
      cachedQueue = raw ? JSON.parse(raw) : [];
    } catch {
      cachedQueue = [];
    }
    return cachedQueue!;
  },

  /** Persist queue to storage */
  async save(queue: QueuedTask[]): Promise<void> {
    cachedQueue = queue;
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    notifyListeners(queue);
  },

  /** Add a task to the queue */
  async enqueue(task: Omit<QueuedTask, 'id' | 'createdAt' | 'status' | 'retryCount'>): Promise<QueuedTask> {
    const queue = await this.load();
    const newTask: QueuedTask = {
      ...task,
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      status: 'queued',
      retryCount: 0,
    };
    queue.push(newTask);
    await this.save(queue);
    return newTask;
  },

  /** Remove a task by ID */
  async removeTask(id: string): Promise<void> {
    const queue = await this.load();
    await this.save(queue.filter(t => t.id !== id));
  },

  /** Update a task's status */
  async updateTask(id: string, updates: Partial<QueuedTask>): Promise<void> {
    const queue = await this.load();
    const idx = queue.findIndex(t => t.id === id);
    if (idx >= 0) {
      queue[idx] = { ...queue[idx], ...updates };
      await this.save(queue);
    }
  },

  /** Get all queued (pending) tasks */
  async getQueue(): Promise<QueuedTask[]> {
    const queue = await this.load();
    return queue.filter(t => t.status === 'queued' || t.status === 'processing');
  },

  /** Get count of pending tasks */
  async getQueueSize(): Promise<number> {
    const pending = await this.getQueue();
    return pending.length;
  },

  /**
   * Process all queued tasks using the current inference provider.
   * Called by the user when they know their server is available.
   *
   * @param processTask - callback that runs inference for a single task.
   *   Receives the task, should return the reply text.
   *   Throws on failure (task stays in queue).
   * @param onTaskCompleted - callback for each completed task (update chat UI).
   */
  async processQueue(
    processTask: (task: QueuedTask) => Promise<string>,
    onTaskCompleted: (task: QueuedTask, reply: string) => void,
  ): Promise<{ processed: number; failed: number }> {
    const queue = await this.load();
    const pending = queue.filter(t => t.status === 'queued');

    let processed = 0;
    let failed = 0;

    for (const task of pending) {
      try {
        await this.updateTask(task.id, { status: 'processing' });
        const reply = await processTask(task);
        await this.removeTask(task.id);
        onTaskCompleted(task, reply);
        processed++;
      } catch (e: any) {
        failed++;
        await this.updateTask(task.id, {
          status: 'queued', // back to queued so user can retry
          retryCount: task.retryCount + 1,
          error: e.message || 'Processing failed',
        });
      }
    }

    return { processed, failed };
  },

  /** Clear the entire queue */
  async clearQueue(): Promise<void> {
    await this.save([]);
  },
};
