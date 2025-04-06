type Query = Record<string, any>;
type Op =
  | '$eq'
  | '$ne'
  | '$gt'
  | '$gte'
  | '$lt'
  | '$lte'
  | '$in'
  | '$nin'
  | '$exists'
  | '$regex'
  | '$size'
  | '$and'
  | '$or'
  | '$not';

function getValue(obj: any, path: string) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function matchField(val: any, cond: any): boolean {
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

export function matches(doc: any, query: Query): boolean {
  return Object.entries(query).every(([key, cond]) => {
    switch (key) {
      case '$or':
        return Array.isArray(cond) && cond.some((q) => matches(doc, q));
      case '$and':
        return Array.isArray(cond) && cond.every((q) => matches(doc, q));
      case '$not':
        return !matches(doc, cond);
      default: {
        const val = getValue(doc, key);
        return matchField(val, cond);
      }
    }
  });
}
