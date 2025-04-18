export type Query<T> = RootLogical<T> & {
  [K in keyof T]?: FieldQuery<T[K]>;
};

type RootLogical<T> = {
  $and?: Query<T>[];
  $or?: Query<T>[];
  $not?: Query<T>;
};

type FieldOps<T> = {
  $eq?: T;
  $ne?: T;
  $gt?: T;
  $gte?: T;
  $lt?: T;
  $lte?: T;
  $exists?: boolean;
  $regex?: string;
  $size?: number;
};

type ArrayOps<T> = {
  $in?: T[];
  $nin?: T[];
};

type FieldQuery<T> = T | (FieldOps<T> & ArrayOps<T>);

export type Op = '$eq' | '$ne' | '$gt' | '$gte' | '$lt' | '$lte' | '$in' | '$nin' | '$and' | '$or' | '$not' | '$exists' | '$regex' | '$size';


function getValue(obj: any, path: string) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function matchField(val: any, cond: any): boolean {
  // { key: undefined } and { key: { $eq: undefined } } are intentional different things
  if (cond === undefined) return true;
  if (typeof cond !== 'object' || cond === null) return val === cond;

  return Object.entries<any>(cond).every(([op, expected]) => {
    switch (op as Op) {
      case '$eq':
        return val === expected;
      case '$ne':
        return val !== expected;
      case '$gt':
        return val > expected;
      case '$gte':
        return val >= expected;
      case '$lt':
        return val < expected;
      case '$lte':
        return val <= expected;
      case '$in':
        return Array.isArray(expected) && expected.includes(val);
      case '$nin':
        return Array.isArray(expected) && !expected.includes(val);
      case '$exists':
        return expected ? val !== undefined : val === undefined;
      case '$regex':
        return typeof val === 'string' && new RegExp(expected).test(val);
      case '$size':
        return Array.isArray(val) && val.length === expected;
      default:
        return false;
    }
  });
}

export function matches<TDoc>(doc: TDoc, query: Query<TDoc>): boolean {
  return Object.entries(query).every(([key, cond]) => {
    switch (key) {
      case '$or':
        return Array.isArray(cond) && cond.some((q) => matches(doc, q));
      case '$and':
        return Array.isArray(cond) && cond.every((q) => matches(doc, q));
      case '$not':
        return !matches(doc, cond as Query<TDoc>);
      default: {
        const val = getValue(doc, key);
        return matchField(val, cond);
      }
    }
  });
}
