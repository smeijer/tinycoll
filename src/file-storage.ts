// file-storage.ts
import { readFile, writeFile } from 'fs/promises';
import type { StorageAdapter } from './storage';

export function createFileStorage(filePath: string): StorageAdapter {
  return {
    async get() {
      try {
        const text = await readFile(filePath, 'utf-8');
        return JSON.parse(text);
      } catch {
        return [];
      }
    },
    async set(_, value) {
      await writeFile(filePath, JSON.stringify(value, null, 2));
    },
  };
}
