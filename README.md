# TinyColl

A minimal reactive document store with Mongo-like querying, reactivity, TTL support, and optional persistence (IndexedDB or filesystem).

## Features

- Reactive `find`, `findOne`, `count`
- Mongo-style query matcher (`$eq`, `$gt`, `$in`, `$or`, etc.)
- Custom TTL indexes (per Mongo's `expireAfterSeconds` style)
- Optional IndexedDB or file persistence
- Fast `Map`-based internal storage
- Signal-based reactivity with `@preact/signals-core`

## Installation 

```shell
npm i tinycoll
```

## Usage

### Create a collection

```ts
const users = new Collection('users');
```

### With persistence

```ts
const users = new Collection('users', { storage: indexedDbStorage });

const users = new Collection('users', {
  storage: createFileStorage('./users.json'),
});
```

### Insert

```ts
users.insert({ name: 'Stephan', city: 'Leeuwarden' });
```

### Query

```ts
// `find()` returns a ReactiveCursor. Supports projection, sorting, and reactivity.
const results = users.find({ city: 'Leeuwarden' }, {
  sort: { name: 1 },
  projection: { name: 1 },
});

effect(() => {
  console.log(results.toArray());
});
```

Reactive results support `.toArray()`, `.map()`, `.watch()`, and pagination helpers like `.paginate(page, perPage)`.

### TTL Index

```ts
new Collection('sessions', {
  ttlIndexes: [
    {
      field: 'lastAccessedAt',
      expireAfterSeconds: 3600,
    },
  ],
});
```

## License
MIT
