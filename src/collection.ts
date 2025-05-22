import { signal, effect } from '@preact/signals-core';
import { matches, Query } from './internal/match.js';
import { newShortId } from './utils.js';
import { StorageAdapter } from './storage.js';
import { PromiseQueue } from './internal/promise-queue.js';
import { applyModifier, Modifier } from './internal/modifier.js';

type Projected<TDoc, TPrj> = keyof TPrj extends never ? TDoc : Pick<TDoc, Extract<keyof TPrj, keyof TDoc>>;
type Projection<TDoc> = Partial<Record<keyof TDoc, 1>>;
type Sort<TDoc> = Partial<Record<keyof TDoc, 1 | -1>>;

type WithId<T = {}> = T & { id: string };
type WithoutId<T = {}> = Omit<T, 'id'>;
type WithOptionalId<T = {}> = WithoutId<T> & { id?: string };

export type Document = WithId<Record<string, any>>

export interface Observer {
  id: string;
  stop: () => void;
}

interface UpdateResult<T> {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedId: string | null;
}

interface FindOptions<TDoc extends Document, TPrj = Projection<TDoc>> {
  projection?: TPrj;
  sort?: Sort<TDoc>;
  skip?: number;
  limit?: number;
}

interface UpdateOptions {
  upsert?: boolean;
}

interface TtlIndex {
  field: string;
  expireAfterSeconds: number;
}

interface Change<T> {
  type: 'added' | 'removed' | 'changed';
  doc: T;
}

class Cursor<TDoc extends Document, TOut = TDoc> {
  #result = signal<Array<TDoc>>([]);
  #hasRun = false;
  #changeHandlers = new Set<(change: Change<TDoc>) => void>();
  #isNotifying = false;
  #pendingChange = false;

  readonly #queryFn: () => Array<TDoc>;
  readonly #options: FindOptions<TDoc>;

  constructor(
    queryFn: () => Array<TDoc>,
    options: FindOptions<TDoc> = {}
  ) {
    this.#queryFn = queryFn;
    this.#options = options;
  }

  #clone(opts: Partial<FindOptions<TDoc>>): Cursor<TDoc, TOut> {
    return new Cursor(this.#queryFn, { ...this.#options, ...opts });
  }

  sort(sort: Sort<TDoc>): Cursor<TDoc, TOut> {
    return this.#clone({ sort });
  }

  limit(limit: number): Cursor<TDoc, TOut> {
    return this.#clone({ limit });
  }

  skip(skip: number): Cursor<TDoc, TOut> {
    return this.#clone({ skip });
  }

  project<
    TProjection = Projection<TDoc>,
    TOut = Cursor<TDoc, Projected<TDoc, TProjection>>
  >(projection: TProjection): TOut {
    return this.#clone({ projection: projection as any }) as TOut;
  }

  paginate(page: number, perPage: number): Cursor<TDoc, TOut> {
    const skip = (page - 1) * perPage;
    return this.skip(skip).limit(perPage);
  }

  #ensureRun() {
    if (this.#hasRun) return;
    this.#hasRun = true;

    let prev = new Map<string, TDoc>();

    effect(() => {
      let docs: TOut[] | TDoc[] = this.#queryFn();

      if (this.#options.sort) docs = sortDocs(docs, this.#options.sort);
      if (this.#options.skip || this.#options.limit !== undefined) {
        docs = docs.slice(
          this.#options.skip || 0,
          (this.#options.skip || 0) + (this.#options.limit ?? docs.length)
        );
      }

      if (this.#options.projection) {
        docs = docs.map((doc) => project(doc, this.#options.projection!)) as unknown as TOut[];
      }

      const next = new Map(docs.map((doc: any) => [doc.id, doc]));

      const added = [...next.entries()].filter(([k]) => !prev.has(k));
      const removed = [...prev.entries()].filter(([k]) => !next.has(k));
      const changed = [...next.entries()].filter(
        ([k, v]) => prev.has(k) && prev.get(k) !== v
      );

      for (const [_, doc] of added) this.#emit({ type: 'added', doc });
      for (const [_, doc] of removed) this.#emit({ type: 'removed', doc });
      for (const [_, doc] of changed) this.#emit({ type: 'changed', doc });

      this.#result.value = Array.from(next.values());
      prev = next;
    });
  }

   #emit(change: Change<TDoc>) {
    if (this.#isNotifying) {
      this.#pendingChange = true;
      return;
    }

    this.#isNotifying = true;

    queueMicrotask(() => {
      this.#isNotifying = false;
      for (const fn of this.#changeHandlers) {
        fn(change);
      }

      if (this.#pendingChange) {
        this.#pendingChange = false;
        this.#emit(change);
      }
    });
  }

  observe(fn: (change: Change<TDoc>) => void): Observer {
    this.#ensureRun();
    const wrapped = Object.assign(fn, { __id: newShortId() });
    this.#changeHandlers.add(wrapped);

    return {
      id: wrapped.__id,
      stop: () => this.#changeHandlers.delete(wrapped),
    };
  }

  watch(callback: (results: TOut[]) => void, options: { immediate?: boolean } = {}): Observer {
    let last: TOut[] = [];
    let scheduled = false;

    const run = () => {
      scheduled = false;
      const next = this.toArray();
      if (
        next.length !== last.length ||
        next.some((v, i) => v !== last[i])
      ) {
        last = next;
        callback(next);
      }
    };

    const observer = this.observe(() => {
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(run);
      }
    });

    if (options.immediate !== false) {
      queueMicrotask(run);
    }

    return observer;
  }

  toArray(): Array<TOut> {
    this.#ensureRun();
    return this.#result.value as unknown as Array<TOut>;
  }

  map<U>(fn: (doc: TDoc) => U): Array<U> {
    this.#ensureRun();
    return this.#result.value.map(fn);
  }

  forEach(fn: (doc: TDoc) => void): void {
    this.#ensureRun();
    this.#result.value.forEach(fn);
  }

  count(): number {
    this.#ensureRun();
    return this.#result.value.length;
  }

  first(): TOut | undefined {
    this.#options.limit = 1;
    return this.toArray()[0];
  }

  last(): TOut | undefined {
    return this.toArray().at(-1);
  }

  exists(): boolean {
    return this.count() > 0;
  }

  group<TGroup extends GroupExpression<TDoc>, TOut = GroupResult<TDoc, TGroup>>(
    group: TGroup
  ): Cursor<TDoc, TOut> {
    return new Cursor(() => {
      this.#ensureRun();
      return groupDocs(this.#result.value, group) as any;
    });
  }

  distinct<K extends keyof TOut>(key: K): Array<TOut[K]> {
    return [...new Set(this.toArray().map((doc) => doc[key]))] as any;
  }
}

function getValue(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function extractMatchingDocs<TDocument extends Document>(query: Query<TDocument>, map: Map<string, TDocument>): TDocument[] {
  if ('id' in query && typeof query.id === 'string') {
    const doc = map.get(query.id);
    return doc && matches(doc, query) ? [doc] : [];
  }
  return Array.from(map.values()).filter((doc) => matches(doc, query));
}

function sortDocs<TDoc>(docs: TDoc[], sort: Sort<TDoc>): TDoc[] {
  return [...docs].sort((a, b) => {
    for (const [key, dir] of Object.entries<any>(sort)) {
      const aVal = getValue(a, key);
      const bVal = getValue(b, key);
      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
    }
    return 0;
  });
}

function groupDocs<TDoc extends Document, TGroup extends GroupExpression<TDoc>>(
  docs: TDoc[],
  group: TGroup
): Array<GroupResult<TDoc, TGroup>> {
  const { key: prop, ...rest } = group;

  const grouped = new Map<any, TDoc[]>();
  for (const doc of docs) {
    const key = getValue(doc, prop);
    const list = grouped.get(key) || [];
    list.push(doc);
    grouped.set(key, list);
  }

  const results = [];
  for (const [key, groupDocs] of grouped.entries()) {
    const out: Record<string, any> = { id: key };
    for (const [field, expr] of Object.entries(rest)) {
      if (typeof expr === 'object' && '$sum' in expr) {
        out[field] = groupDocs.length;
      } else if (typeof expr === 'object' && '$push' in expr) {
        const val = expr.$push;
        if (val === '$$ROOT') {
          out[field] = [...groupDocs];
        } else if (typeof val === 'string') {
          out[field] = groupDocs.map((doc) => getValue(doc, val));
        }
      }
    }
    results.push(out);
  }

  return results as any;
}

function project<TDoc, TPrj extends Projection<TDoc>>(
  doc: TDoc,
  projection: TPrj
): Projected<TDoc, TPrj> {
  const out: Partial<TDoc> = {};
  for (const key of Object.keys(projection)) {
    out[key as keyof TDoc] = getValue(doc, key);
  }

  return out as Projected<TDoc, TPrj>;
}

function isValidName(name: string) {
  return /^[a-z][a-z0-9_]*$/.test(name);
}

export class Collection<TDoc extends Document, TMeta extends WithoutId<Document> = {}> {
  #dbKey: string;
  #docs = signal<Map<string, TDoc>>(new Map());
  #storage?: StorageAdapter;
  #ttlIndexes: TtlIndex[] = [];
  #ttlInterval: number;
  #isBatching = false;
  #localClone = new Map<string, TDoc>();
  #meta: Meta<WithId<TMeta>> | null = null;
  #ready: Promise<void>;
  #txQueue = new PromiseQueue();
  #ttlIntervalId?: NodeJS.Timeout;

  get meta(): Meta<WithId<TMeta>> {
    if (!this.#meta) throw new Error('Collection is not initialized');
    return this.#meta;
  }

  constructor(name: string, options?: { storage?: StorageAdapter; ttlIndexes?: TtlIndex[]; ttlInterval?: number }) {
    if (this.constructor !== Meta && !isValidName(name)) {
      throw new Error(`Invalid collection name: ${name}`);
    }

    this.#dbKey = name;
    this.#storage = options?.storage;
    this.#ttlIndexes = options?.ttlIndexes || [];
    this.#ttlInterval = options?.ttlInterval ?? 60_000;

    if (name !== '_meta') {
      this.#meta = new Meta(name, { storage: options?.storage });
    }

    this.#ready = new Promise(async (resolve) => {
      await Promise.all([
        this.#initStorage(),
        this.#meta?.ready,
      ]);

      queueMicrotask(() => resolve());
    });

    if (this.#ttlIndexes.length > 0) {
      this.#ttlIntervalId = setInterval(() => this.#processTtlIndexes(), this.#ttlInterval);
    }
  }

  dispose() {
    clearInterval(this.#ttlIntervalId);
  }

  #processTtlIndexes() {
    const now = Date.now();
    const updated = new Map(this.#docs.value);
    let changed = false;
    for (const [id, doc] of updated) {
      for (const index of this.#ttlIndexes) {
        const ts = getValue(doc, index.field);
        if (typeof ts === 'number' && now >= ts + index.expireAfterSeconds * 1000) {
          updated.delete(id);
          changed = true;
          break;
        }
      }
    }

    if (changed) this.#docs.value = updated;
  }

  async #initStorage() {
    if (!this.#storage) return;

    const stored = await this.#storage.get(this.#dbKey);

    if (Array.isArray(stored)) {
      // need to spread, the signal won't catch this change otherwise
      this.#docs.value = new Map(stored.map((doc) => [doc.id!, { ...doc }]));
    }

    effect(() => {
      const docs = Array.from(this.#docs.value.values());
      this.#storage?.set(this.#dbKey, docs);
    });
  }

  onReady(callback: () => void) {
    void this.#ready.then(callback);
  }

  get ready() {
    return this.#ready;
  }

  batch<Fn extends () => any>(fn: Fn): ReturnType<Fn> extends Promise<any> ? Promise<void> : void {
    this.#isBatching = true;

    try {
      const result = fn();

      if (result instanceof Promise) {
        return result.then(() => {}).finally(() => {
          this.#docs.value = this.#localClone;
          this.#localClone = new Map();
          this.#isBatching = false;
        }) as any;
      }

      this.#docs.value = this.#localClone;
      this.#localClone = new Map();
      this.#isBatching = false;
      return result;
    } catch (err) {
      this.#localClone = new Map();
      this.#isBatching = false;
      throw err;
    }
  }

  insert(doc: WithOptionalId<TDoc>) {
    const id = doc.id || newShortId();
    const newDoc = { ...doc, id } as TDoc;
    if (this.#isBatching) {
      this.#localClone.set(id, newDoc);
    } else {
      this.#docs.value = new Map(this.#docs.value).set(id, newDoc);
    }
  }

  update(
    query: Query<TDoc>,
    modifier: Modifier<TDoc>,
    opts: UpdateOptions = {}
  ): UpdateResult<TDoc> {
    const updated = this.#isBatching ? this.#localClone : new Map(this.#docs.value);
    const matchesList = extractMatchingDocs(query, updated);

    let matchedCount = 0;
    let modifiedCount = 0;

    for (const doc of matchesList) {
      matchedCount++;
      const modified = applyModifier(doc, modifier);
      if (modified !== doc) {
        updated.set(modified.id!, modified);
        modifiedCount++;
      }
    }

    let upsertedId: string | null = null;
    if (matchedCount === 0 && opts.upsert) {
      const base: TDoc = { ...query } as TDoc;
      const applied = applyModifier(base, modifier, { inserting: true });
      if (!applied.id) applied.id = newShortId();
      updated.set(applied.id, applied);
      upsertedId = applied.id;
    }

    if (!this.#isBatching) {
      this.#docs.value = updated;
    }

    return {
      matchedCount,
      modifiedCount,
      upsertedCount: upsertedId ? 1 : 0,
      upsertedId,
    };
  }

  remove(query: Query<TDoc>) {
    if (Object.keys(query).length === 0) {
      this.#docs.value = new Map();
      return;
    }

    const updated = this.#isBatching ? this.#localClone : new Map(this.#docs.value);
    const targets = extractMatchingDocs(query, updated);
    for (const doc of targets) {
      updated.delete(doc.id!);
    }

    if (!this.#isBatching) {
      this.#docs.value = updated;
    }
  }

  async transaction(fn: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#txQueue.push(async () => {
        const snapshot = new Map(this.#docs.value);
        try {
          await this.batch(fn);
          resolve();
        } catch (err) {
          this.#docs.value = snapshot;
          reject(err);
        }
      });
    });
  }

  find<TPrj extends Projection<TDoc> = {}, TOut = Projected<TDoc, TPrj>>(
    query: Query<TDoc> = {},
    opts: FindOptions<TDoc, TPrj> = {}
  ) {
    return new Cursor<TDoc, TOut>(() => extractMatchingDocs(query, this.#docs.value), opts);
  }

  findOne<TPrj extends Projection<TDoc> = {}, TOut = Projected<TDoc, TPrj>>(
    query: Query<TDoc>,
    opts: FindOptions<TDoc, TPrj> = {}
  ) {
    return this.find<TPrj, TOut>(query, { ...opts, limit: 1 }).first();
  }

  count(query: Query<TDoc> = {}) {
    return this.find(query).count();
  }
}

type SumAccumulator = { $sum: 1 };
type PushAccumulator<T extends Document> = { $push: '$$ROOT' } | { $push: keyof T };
type GroupAccumulator<T extends Document> = SumAccumulator | PushAccumulator<T>;

type GroupExpression<T extends Document> = {
  key: Extract<keyof T, string>;
  [key: string]: GroupAccumulator<T> | keyof T;
};

type GroupResult<TDoc extends Document, TGroup extends GroupExpression<TDoc>> = {
  [K in keyof TGroup]:
    K extends 'key'
      ? TGroup[K] extends keyof TDoc
        ? TDoc[TGroup[K]]
        : unknown
      : TGroup[K] extends { $sum: 1 }
        ? number
        : TGroup[K] extends { $push: '$$ROOT' }
          ? TDoc[]
          : TGroup[K] extends { $push: keyof TDoc }
            ? Array<TDoc[TGroup[K]['$push']]>
            : never;
};

class Meta<TMeta extends Document> extends Collection<WithId<TMeta>, {}> {
  #name: string;

  constructor(name: string, options: { storage?: StorageAdapter }) {
    super('_meta', { storage: options.storage });
    this.#name = name;
  }

  get<K extends keyof TMeta>(key: K): TMeta[K] | undefined {
    return this.findOne({ id: this.#name })?.[key];
  }

  set<K extends keyof TMeta>(key: K, value: TMeta[K]): void {
    this.update({ id: this.#name }, { $set: { [key]: value } as any }, { upsert: true });
  }
}

