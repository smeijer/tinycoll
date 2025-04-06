import { signal, effect, Signal } from '@preact/signals-core';
import { matches } from './match';
import { uuid } from './utils';

export type Document = {
  _id?: string;
} & Record<string, any>;

export type StorageAdapter = {
  get: (key: string) => Promise<any>;
  set: (key: string, val: any) => Promise<void>;
};

interface UpdateResult<T> {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedId: string | null;
}

interface FindOptions {
  projection?: Record<string, 1>;
  sort?: Record<string, 1 | -1>;
  skip?: number;
  limit?: number;
}

interface TtlIndex {
  field: string;
  expireAfterSeconds: number;
}

interface UpdateOptions {
  upsert?: boolean;
}

type Change<T> = { type: 'added' | 'removed' | 'changed'; doc: T };

class ReactiveCursor<T> {
  private result = signal<Array<T>>([]);
  private hasRun = false;
  private changeHandlers = new Set<(change: Change<T>) => void>();

  constructor(
    private queryFn: () => Array<T>,
    private options: FindOptions = {}
  ) {}

  private ensureRun() {
    if (this.hasRun) return;
    this.hasRun = true;

    let prev = new Map<string, T>();

    effect(() => {
      const next = new Map(this.queryFn().map((doc: any) => [doc._id, doc]));

      const added = [...next.entries()].filter(([k]) => !prev.has(k));
      const removed = [...prev.entries()].filter(([k]) => !next.has(k));
      const changed = [...next.entries()].filter(
        ([k, v]) => prev.has(k) && prev.get(k) !== v
      );

      for (const [_, doc] of added) this.emit({ type: 'added', doc });
      for (const [_, doc] of removed) this.emit({ type: 'removed', doc });
      for (const [_, doc] of changed) this.emit({ type: 'changed', doc });

      this.result.value = Array.from(next.values());
      prev = next;
    });
  }

  private emit(change: Change<T>) {
    for (const fn of this.changeHandlers) fn(change);
  }

  observe(fn: (change: Change<T>) => void): () => void {
    this.ensureRun();
    this.changeHandlers.add(fn);
    return () => this.changeHandlers.delete(fn);
  }

  toArray(): Array<T> {
    this.ensureRun();
    return this.result.value;
  }

  map<U>(fn: (doc: T) => U): Array<U> {
    this.ensureRun();
    return this.result.value.map(fn);
  }

  forEach(fn: (doc: T) => void): void {
    this.ensureRun();
    this.result.value.forEach(fn);
  }

  count(): number {
    this.ensureRun();
    return this.result.value.length;
  }

  first(): T | undefined {
    this.options.limit = 1;
    return this.toArray()[0];
  }

  last(): T | undefined {
    return this.toArray().at(-1);
  }

  exists(): boolean {
    return this.count() > 0;
  }
}

function getValue(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function setValue(obj: any, path: string, value: any): any {
  const keys = path.split('.');
  const last = keys.pop()!;
  let updated = structuredClone(obj);
  let target = updated;
  for (const k of keys) {
    target[k] = structuredClone(target[k] ?? {});
    target = target[k];
  }
  target[last] = value;
  return updated;
}

function unsetValue(obj: any, path: string): any {
  const keys = path.split('.');
  const last = keys.pop()!;
  let updated = structuredClone(obj);
  let parent = updated;
  for (const k of keys) {
    parent[k] = structuredClone(parent[k] ?? {});
    parent = parent[k];
  }
  delete parent[last];
  return updated;
}

function applyModifier(doc: Document, mod: any): Document {
  let updated = doc;

  if (mod.$set) {
    for (const [k, v] of Object.entries(mod.$set)) {
      const current = getValue(updated, k);
      if (current !== v) updated = setValue(updated, k, v);
    }
  }

  if (mod.$inc) {
    for (const [k, v] of Object.entries<any>(mod.$inc)) {
      const current = getValue(updated, k);
      updated = setValue(updated, k, (typeof current === 'number' ? current : 0) + v);
    }
  }

  if (mod.$unset) {
    for (const k of Object.keys(mod.$unset)) {
      if (getValue(updated, k) !== undefined) {
        updated = unsetValue(updated, k);
      }
    }
  }

  if (mod.$push) {
    for (const [k, v] of Object.entries(mod.$push)) {
      const arr = getValue(updated, k);
      updated = setValue(updated, k, Array.isArray(arr) ? [...arr, v] : [v]);
    }
  }

  if (mod.$pull) {
    for (const [k, v] of Object.entries(mod.$pull)) {
      const arr = getValue(updated, k);
      if (Array.isArray(arr)) {
        updated = setValue(updated, k, arr.filter((item) => item !== v));
      }
    }
  }

  return updated;
}

function extractMatchingDocs(query: Record<string, any>, map: Map<string, Document>): Document[] {
  if ('_id' in query && typeof query._id === 'string') {
    const doc = map.get(query._id);
    return doc && matches(doc, query) ? [doc] : [];
  }
  return Array.from(map.values()).filter((doc) => matches(doc, query));
}

function sortDocs(docs: any[], sort: Record<string, 1 | -1>): any[] {
  return [...docs].sort((a, b) => {
    for (const [key, dir] of Object.entries(sort)) {
      const aVal = getValue(a, key);
      const bVal = getValue(b, key);
      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
    }
    return 0;
  });
}

function project(doc: any, projection: Record<string, 1>): any {
  const out: any = {};
  for (const key in projection) {
    out[key] = getValue(doc, key);
  }
  return out;
}

export function createCollection(
  name: string,
  options?: {
    storage?: StorageAdapter;
    ttlIndexes?: TtlIndex[];
  }
) {
  const dbKey = `coll::${name}`;
  const docsMap = signal<Map<string, Document>>(new Map());
  const storage = options?.storage;
  const ttlIndexes = options?.ttlIndexes || [];

  if (storage) {
    storage.get(dbKey).then((stored) => {
      if (Array.isArray(stored)) {
        docsMap.value = new Map(stored.map((doc) => [doc._id!, doc]));
      }
    });

    effect(() => void storage.set(dbKey, Array.from(docsMap.value.values())));
  }

  setInterval(() => {
    const now = Date.now();
    const updated = new Map(docsMap.value);
    let changed = false;
    for (const [id, doc] of updated) {
      for (const index of ttlIndexes) {
        const ts = getValue(doc, index.field);
        if (typeof ts === 'number' && now >= ts + index.expireAfterSeconds * 1000) {
          updated.delete(id);
          changed = true;
          break;
        }
      }
    }
    if (changed) docsMap.value = updated;
  }, 60_000);

  return {
    insert(doc: Document) {
      const _id = doc._id || uuid();
      docsMap.value = new Map(docsMap.value).set(_id, { ...doc, _id });
    },

    update(
      query: Record<string, any>,
      modifier: any,
      opts: UpdateOptions = {}
    ): UpdateResult<Document> {
      const updated = new Map(docsMap.value);
      const matchesList = extractMatchingDocs(query, updated);

      let matchedCount = 0;
      let modifiedCount = 0;

      for (const doc of matchesList) {
        matchedCount++;
        const modified = applyModifier(doc, modifier);
        if (modified !== doc) {
          updated.set(modified._id!, modified);
          modifiedCount++;
        }
      }

      let upsertedId: string | null = null;
      if (matchedCount === 0 && opts.upsert) {
        const base: Document = { ...query };
        const applied = applyModifier(base, modifier);
        if (!applied._id) applied._id = uuid();
        updated.set(applied._id, applied);
        upsertedId = applied._id;
      }

      docsMap.value = updated;

      return {
        matchedCount,
        modifiedCount,
        upsertedCount: upsertedId ? 1 : 0,
        upsertedId,
      };
    },

    remove(query: Record<string, any>) {
      if (Object.keys(query).length === 0) {
        docsMap.value = new Map();
        return;
      }

      const updated = new Map(docsMap.value);
      const targets = extractMatchingDocs(query, updated);
      for (const doc of targets) {
        updated.delete(doc._id!);
      }
      docsMap.value = updated;
    },

    find(query: Record<string, any> = {}, opts: FindOptions = {}) {
      return new ReactiveCursor(() => {
        let docs = extractMatchingDocs(query, docsMap.value);
        if (opts.sort) docs = sortDocs(docs, opts.sort);
        if (opts.skip || opts.limit !== undefined) {
          docs = docs.slice(opts.skip || 0, (opts.skip || 0) + (opts.limit ?? docs.length));
        }
        if (opts.projection) docs = docs.map((doc) => project(doc, opts.projection!));
        return docs;
      }, opts);
    },

    findOne(query: Record<string, any>, opts: FindOptions = {}): Document | undefined {
      return this.find(query, { ...opts, limit: 1 }).first();
    },

    count(query: Record<string, any> = {}) {
      return this.find(query).count();
    }
  };
}
