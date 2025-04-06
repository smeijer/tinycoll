import { get, set, clear,  createStore, type UseStore } from 'idb-keyval';
import type { StorageAdapter } from './storage.js';

export class IndexedDbStorage implements StorageAdapter {
  #store: UseStore;

  constructor() {
    this.#store = createStore('tinycoll', 'tinycoll');
  }

  get(key: string) {
    return get(key, this.#store);
  }

  set(key: string, val: any) {
    return set(key, val, this.#store);
  }

  static async clear() {
    return clear(createStore('tinycoll', 'tinycoll'));
  }
}

if (typeof window !== 'undefined') {
  (window as any)['idb'] = IndexedDbStorage;
}
