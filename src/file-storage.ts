// file-storage.ts
import { readFile, writeFile } from 'fs/promises';
import type { StorageAdapter } from './storage.js';

export class FileStorage implements StorageAdapter {
  #filePath: string;

  constructor(options: { filePath: string }) {
    this.#filePath = options.filePath;
  }

  async get() {
    try {
      const text = await readFile(this.#filePath, 'utf-8');
      return JSON.parse(text);
    } catch {
      return [];
    }
  }

  async set(_: string, value: any) {
    await writeFile(this.#filePath, JSON.stringify(value, null, 2));
  }
}
