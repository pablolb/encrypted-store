# Encrypted Store

Client-side encrypted storage with change detection for PWAs. Built on [Fireproof](https://use-fireproof.com).

**For small data that can live in memory** - Designed for PWAs that manage datasets that fit comfortably in browser memory.

## Features

- 🔐 AES-256-GCM encryption before storage
- 🔄 Real-time change detection (added/changed/deleted events)
- 📱 PWA-ready with offline-first support
- 🌐 Optional remote sync (PartyKit, Netlify)
- 📦 TypeScript with full type safety

## Installation

```bash
npm install @mrbelloc/encrypted-store
```

## Quick Start

```typescript
import { EncryptedStore, fireproof } from "@mrbelloc/encrypted-store";

// Create database and encrypted store
const db = fireproof("myapp");
const store = new EncryptedStore(db, "my-password", {
  docsAdded: (events) => {
    events.forEach(({ table, docs }) => {
      console.log(`New ${table}:`, docs);
    });
  },
  docsChanged: (events) => {
    events.forEach(({ table, docs }) => {
      console.log(`Updated ${table}:`, docs);
    });
  },
  docsDeleted: (events) => {
    events.forEach(({ table, docs }) => {
      console.log(`Deleted ${table}:`, docs);
    });
  },
});

// Load existing data
await store.loadAll();

// Create/update documents
await store.put("users", { _id: "alice", name: "Alice", age: 30 });

// Get documents
const user = await store.get("users", "alice");

// Delete documents
await store.delete("users", "alice");
```

## API Reference

### `new EncryptedStore(db, password, listener)`

Creates an encrypted store.

- `db`: Fireproof database instance
- `password`: Encryption password (string)
- `listener`: Object with three callbacks:
  - `docsAdded(events: TableEvent[])`: Fired when new documents are added
  - `docsChanged(events: TableEvent[])`: Fired when documents are updated
  - `docsDeleted(events: TableEvent[])`: Fired when documents are deleted

Each `TableEvent` has:

- `table`: Document type (e.g., "users", "transactions")
- `docs`: Array of documents with that type

### `await store.loadAll()`

Loads all existing documents and sets up change detection. Call this once after creating the store.

### `await store.put(type, doc)`

Creates or updates a document.

- `type`: Document type / table name (string)
- `doc`: Document object with `_id` field (will be generated if missing)

Returns the document.

### `await store.get(type, id)`

Retrieves a document by type and ID. Returns `null` if not found.

### `await store.delete(type, id)`

Deletes a document by type and ID.

## Remote Sync

Sync encrypted data across devices with any Fireproof connector:

```typescript
// Install the connector you want
// npm install @fireproof/partykit
// or
// npm install @fireproof/netlify

import { connect } from "@fireproof/partykit";
// or
// import { connect } from "@fireproof/netlify";

// Connect using the connector function
await store.connectRemote(connect, {
  namespace: "my-app",
  host: "http://localhost:1999", // or your server URL
});

// Disconnect
store.disconnectRemote();

// Works with any connector that follows the Fireproof connector interface
```

**Note:** Remote servers only see encrypted blobs - they cannot read your data.

## How It Works

1. **Encryption**: Documents are encrypted with AES-256-GCM before storage
2. **Storage**: Encrypted blobs stored in Fireproof (local-first IndexedDB)
3. **Change Detection**: Fireproof's subscribe notifies us of changes
4. **Diff Computation**: We track IDs and decrypt only changed documents
5. **Events**: Your app gets organized events by table (added/changed/deleted)

## Example: React Integration

```typescript
import { useState, useEffect } from "react";
import { EncryptedStore, fireproof } from "@mrbelloc/encrypted-store";

function useEncryptedStore(dbName: string, password: string) {
  const [users, setUsers] = useState<Map<string, any>>(new Map());
  const [store, setStore] = useState<EncryptedStore | null>(null);

  useEffect(() => {
    const db = fireproof(dbName);
    const encryptedStore = new EncryptedStore(db, password, {
      docsAdded: (events) => {
        events.forEach(({ table, docs }) => {
          if (table === "users") {
            setUsers((prev) => {
              const next = new Map(prev);
              docs.forEach((doc) => next.set(doc._id, doc));
              return next;
            });
          }
        });
      },
      docsChanged: (events) => {
        events.forEach(({ table, docs }) => {
          if (table === "users") {
            setUsers((prev) => {
              const next = new Map(prev);
              docs.forEach((doc) => next.set(doc._id, doc));
              return next;
            });
          }
        });
      },
      docsDeleted: (events) => {
        events.forEach(({ table, docs }) => {
          if (table === "users") {
            setUsers((prev) => {
              const next = new Map(prev);
              docs.forEach((doc) => next.delete(doc._id));
              return next;
            });
          }
        });
      },
    });

    encryptedStore.loadAll();
    setStore(encryptedStore);
  }, [dbName, password]);

  return { users: Array.from(users.values()), store };
}
```

## TypeScript Types

```typescript
interface TableEvent {
  table: string;
  docs: Doc[];
}

interface StoreListener {
  docsAdded: (events: TableEvent[]) => void;
  docsChanged: (events: TableEvent[]) => void;
  docsDeleted: (events: TableEvent[]) => void;
}

interface Doc {
  _id: string;
  [key: string]: any;
}
```

## License

MIT
