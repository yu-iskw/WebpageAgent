import type { EventSubscriber } from './contracts.js';
import type { ExecutionEvent } from './types.js';

export class EventBus {
  readonly #subscribers = new Set<EventSubscriber>();

  subscribe(subscriber: EventSubscriber): () => void {
    this.#subscribers.add(subscriber);
    return () => this.#subscribers.delete(subscriber);
  }

  async emit(event: ExecutionEvent): Promise<void> {
    await Promise.all([...this.#subscribers].map(async (subscriber) => subscriber(event)));
  }
}
