import { Document } from './store';

export type Modifier<T> = {
  $set?: Partial<T>;
  $unset?: Partial<Record<keyof T, true>>;
  $push?: Arrays<T>;
  $pull?: Arrays<T>;
  $inc?: Numbers<T>;
  $min?: Numbers<T>;
  $max?: Numbers<T>;
  $mul?: Numbers<T>;
  $setOnInsert?: Partial<T>;
  $addToSet?: Arrays<T>;
};

type Numbers<T> = {
  [K in keyof T as T[K] extends number ? K : never]?: number;
};

type Arrays<T> = {
  [K in keyof T as T[K] extends any[] ? K : never]?: T[K] extends (infer U)[] ? U : never;
};

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

export function applyModifier<TDoc extends Document>(
  doc: TDoc,
  mod: Modifier<TDoc>,
  ctx: { inserting?: boolean } = {}
): TDoc {
  let updated = doc;
  if (mod.$setOnInsert && ctx.inserting) {
    for (const [k, v] of Object.entries(mod.$setOnInsert)) {
      if (getValue(updated, k) === undefined) {
        updated = setValue(updated, k, v);
      }
    }
  }

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

  if (mod.$min) {
    for (const [k, v] of Object.entries<any>(mod.$min)) {
      const current = getValue(updated, k);
      if (typeof current === 'number' && typeof v === 'number') {
        if (v < current) updated = setValue(updated, k, v);
      }
    }
  }

  if (mod.$max) {
    for (const [k, v] of Object.entries<any>(mod.$max)) {
      const current = getValue(updated, k);
      if (typeof current === 'number' && typeof v === 'number') {
        if (v > current) updated = setValue(updated, k, v);
      }
    }
  }

  if (mod.$mul) {
    for (const [k, v] of Object.entries<any>(mod.$mul)) {
      const current = getValue(updated, k);
      updated = setValue(updated, k, (typeof current === 'number' ? current : 0) * v);
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

  if (mod.$addToSet) {
    for (const [k, v] of Object.entries(mod.$addToSet)) {
      const arr = getValue(updated, k);
      if (Array.isArray(arr)) {
        if (!arr.includes(v)) {
          updated = setValue(updated, k, [...arr, v]);
        }
      } else {
        updated = setValue(updated, k, [v]);
      }
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
