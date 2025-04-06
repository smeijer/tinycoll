// indexeddb-storage.ts
import { get, set } from 'idb-keyval';
import type { StorageAdapter } from './storage';

export const indexedDbStorage: StorageAdapter = {
  get,
  set,
};
