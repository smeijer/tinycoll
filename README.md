# Tiny Mongo Store

A minimal reactive document store with Mongo-like querying, reactivity, TTL support, and optional persistence (IndexedDB or filesystem).

## Features

- Reactive `find`, `findOne`, `count`, `watchById`
- Mongo-style query matcher (`$eq`, `$gt`, `$in`, `$or`, etc.)
- Custom TTL indexes (per Mongo's `expireAfterSeconds` style)
- Optional IndexedDB or file persistence
- Fast `Map`-based internal storage
- Signal-based reactivity with `@preact/signals-core`

## Usage

### Create a collection

```ts
const users = createCollection('users');
```

### With persistence

```ts
const users = createCollection('users', { storage: indexedDbStorage });

const users = createCollection('users', {
  storage: createFileStorage('./users.json'),
});
```

### Insert

```ts
users.insert({ name: 'Stephan', city: 'Leeuwarden' });
```

### Query

```ts
const results = users.find({ city: 'Leeuwarden' }, {
  sort: { name: 1 },
  projection: { name: 1 },
});

effect(() => {
  console.log(results.value);
});
```

### TTL Index

```ts
createCollection('sessions', {
  ttlIndexes: [
    {
      field: 'lastAccessedAt',
      expireAfterSeconds: 3600,
    },
  ],
});
```

## Install

You’ll need:

- `@preact/signals-core`
- Optionally: `idb-keyval` if using IndexedDB

```bash
npm install @preact/signals-core idb-keyval
```

## License
MIT
