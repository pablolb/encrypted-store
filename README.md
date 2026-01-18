# Encrypted Store

Client-side encrypted document storage with change detection using PouchDB and AES-256-GCM encryption.

**Simple API for offline-first apps** - PUT, GET, DELETE documents with automatic sync to CouchDB.

## Features

- 🔐 AES-256-GCM encryption with WebCrypto API
- 📦 Simple document API: `put`, `get`, `delete`, `getAll`
- 🔄 Real-time change detection (`onChange`, `onDelete`)
- ⚠️ Conflict detection and resolution
- 🌐 Sync to CouchDB (or any PouchDB-compatible server)
- 📊 Sync progress events
- 🔌 Offline-first with automatic retry
- 📱 Works in browser and Node.js
- 🎯 TypeScript with full type safety

## Installation

### For Browser (Vite/Webpack)

```bash
npm install @mrbelloc/encrypted-store pouchdb-browser@^8.0.1 events
```

**Note:** Currently requires PouchDB v8. PouchDB v9 has compatibility issues with TypeScript types and some bundlers.

**Required for Vite:** Install the `events` package to fix "Class extends value [object Object]" errors.

### For Node.js

```bash
npm install @mrbelloc/encrypted-store pouchdb
```

## Quick Start

### Browser (Vite/React/Vue/Svelte)

```typescript
import PouchDBModule from 'pouchdb-browser';
// Workaround for ESM/CommonJS compatibility in some bundlers
const PouchDB = PouchDBModule.default || PouchDBModule;
import { EncryptedStore } from '@mrbelloc/encrypted-store';

// Create database and encrypted store (uses IndexedDB in browser)
const db = new PouchDB('myapp');
const store = new EncryptedStore(db, 'my-password', {
  onChange: (docs) => {
    console.log('Documents changed:', docs);
  },
  onDelete: (docs) => {
    console.log('Documents deleted:', docs);
  },
  onConflict: (conflicts) => {
    console.log('Conflicts detected:', conflicts);
  },
  onSync: (info) => {
    console.log('Sync progress:', info);
  },
  onError: (errors) => {
    console.error('Decryption errors:', errors);
  }
});

// Load existing data and start change detection
await store.loadAll();

// Create/update documents
await store.put('expenses', { 
  _id: 'lunch', 
  amount: 15.50, 
  date: '2024-01-15' 
});

// Get a document
const expense = await store.get('expenses', 'lunch');
console.log(expense); // { _id: 'lunch', _table: 'expenses', amount: 15.50, date: '2024-01-15' }

// Get all documents (optionally filtered by table)
const allExpenses = await store.getAll('expenses');
const allDocs = await store.getAll();

// Delete a document
await store.delete('expenses', 'lunch');

// Sync to CouchDB
await store.connectRemote({
  url: 'http://localhost:5984/myapp',
  live: true,
  retry: true
});
```

### Node.js

```typescript
import PouchDB from 'pouchdb';
import { EncryptedStore } from '@mrbelloc/encrypted-store';

// Create database and encrypted store (uses LevelDB in Node)
const db = new PouchDB('myapp');
const store = new EncryptedStore(db, 'my-password', {
  onChange: (docs) => console.log('Changed:', docs),
  onDelete: (docs) => console.log('Deleted:', docs),
});

await store.loadAll();
```

## API Reference

### `new EncryptedStore(db, password, listener?, options?)`

Creates an encrypted store.

- `db`: PouchDB database instance
- `password`: Encryption password (string)
- `listener`: Optional object with callbacks
- `options`: Optional configuration object

**Options:**

```typescript
interface EncryptedStoreOptions {
  passphraseMode?: "derive" | "raw";  // default: "derive"
}
```

- **`passphraseMode: "derive"`** (default): Uses PBKDF2 with 100k iterations for user passphrases. Recommended for production use. Provides strong protection against brute-force and dictionary attacks. First unlock will take ~50-100ms.
- **`passphraseMode: "raw"`**: Uses SHA-256 only. For pre-derived keys or advanced users who handle key derivation themselves. Allows full control over KDF algorithm, iterations, and progress UI.

### Listener Callbacks

```typescript
interface StoreListener {
  onChange: (docs: Doc[]) => void;
  onDelete: (docs: Doc[]) => void;
  onConflict?: (conflicts: ConflictInfo[]) => void;
  onSync?: (info: SyncInfo) => void;
  onError?: (errors: DecryptionErrorEvent[]) => void;
}
```

- **`onChange(docs)`**: Called when documents are added or updated
- **`onDelete(docs)`**: Called when documents are deleted
- **`onConflict(conflicts)`**: Called when conflicts are detected
- **`onSync(info)`**: Called during sync operations
- **`onError(errors)`**: Called when documents fail to decrypt

### `await store.loadAll()`

Loads all existing documents and starts change detection. Call this once after creating the store.

### `await store.put(table, doc)`

Creates or updates a document.

- `table`: Document type (e.g., "expenses", "tasks")
- `doc`: Document object with optional `_id` field (generated if missing)

Returns the document with `_table` field added.

### `await store.get(table, id)`

Gets a document by table and ID. Returns `null` if not found.

### `await store.delete(table, id)`

Deletes a document by table and ID.

### `await store.deleteAllLocal()`

Deletes all documents locally only. Automatically disconnects sync first to prevent deletions from propagating to remote. Use this when you want to clear local data only.

```typescript
// Clear all local data without affecting remote
await store.deleteAllLocal();
```

### `await store.deleteAllAndSync()`

Deletes all documents locally AND propagates deletions to remote. Waits for sync to complete before returning. Throws an error if sync is not connected.

```typescript
// Connect to remote first
await store.connectRemote({ url: 'http://localhost:5984/mydb' });

// Delete everything locally and remotely
await store.deleteAllAndSync();
```

**Note:** Call `connectRemote()` first, or use `deleteAllLocal()` instead.

### `await store.getAll(table?)`

Gets all documents, optionally filtered by table.

```typescript
const allExpenses = await store.getAll('expenses');
const allDocs = await store.getAll();
```

### `await store.connectRemote(options)`

Connects to a remote CouchDB server for sync.

```typescript
interface RemoteOptions {
  url: string;        // CouchDB URL
  live?: boolean;     // Continuous sync (default: true)
  retry?: boolean;    // Auto-retry on failure (default: true)
}
```

### `store.disconnectRemote()`

Disconnects from remote sync.

### `await store.syncNow()`

Triggers an immediate one-time sync with the remote. Useful for controlling sync timing, especially with rate-limited services like IBM Cloudant's free tier.

```typescript
// Connect with continuous sync disabled
await store.connectRemote({
  url: 'http://localhost:5984/mydb',
  live: false,
  retry: false
});

// Manually trigger sync when needed
await store.syncNow();

// Example: Batch multiple changes then sync
await store.put('expenses', { _id: '1', amount: 10 });
await store.put('expenses', { _id: '2', amount: 20 });
await store.put('expenses', { _id: '3', amount: 30 });
await store.syncNow(); // Sync all changes at once
```

Throws an error if `connectRemote()` hasn't been called first.

### `store.reconnect()`

Re-subscribes to changes. Useful after disconnect/reconnect scenarios or if the change feed needs to be restarted.

```typescript
// Restart the change detection feed
store.reconnect();
```

### `await store.getConflictInfo(table, id)`

Check if a document has conflicts without triggering the callback. Returns `ConflictInfo` if conflicts exist, or `null` if none.

```typescript
const conflictInfo = await store.getConflictInfo('expenses', 'lunch');
if (conflictInfo) {
  console.log('Conflict detected!');
  console.log('Winner:', conflictInfo.winner);
  console.log('Losers:', conflictInfo.losers);
  // Handle the conflict
}
```

### `await store.resolveConflict(table, id, winningDoc)`

Manually resolve a conflict by choosing the winning document.

```typescript
// Option 1: Use in onConflict callback
store.listener.onConflict = async (conflicts) => {
  for (const conflict of conflicts) {
    // Pick the document with the latest timestamp
    const latest = [conflict.winner, ...conflict.losers]
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    
    await store.resolveConflict(conflict.table, conflict.id, latest);
  }
};

// Option 2: Check manually and resolve
const conflict = await store.getConflictInfo('expenses', 'lunch');
if (conflict) {
  await store.resolveConflict('expenses', 'lunch', conflict.winner);
}
```

## Conflict Detection

When the same document is edited offline on multiple devices, PouchDB detects conflicts automatically:

```typescript
interface ConflictInfo {
  docId: string;         // Full document ID (e.g., "expenses_lunch")
  table: string;         // Document table (e.g., "expenses")
  id: string;            // Document ID (e.g., "lunch")
  currentRev: string;    // Current revision ID
  conflictRevs: string[];// Conflicting revision IDs
  winner: Doc;           // The winning document (current version)
  losers: Doc[];         // Conflicting versions
}
```

The `onConflict` callback gives you both the winner and all conflicting versions, so you can:
- Show a UI for manual resolution
- Auto-resolve based on timestamps
- Merge changes programmatically
- Log conflicts for review

## Sync Events

Monitor sync progress with the `onSync` callback:

```typescript
interface SyncInfo {
  direction: 'push' | 'pull' | 'both';
  change: {
    docs_read?: number;
    docs_written?: number;
    doc_write_failures?: number;
    errors?: any[];
  };
}
```

Example:

```typescript
const store = new EncryptedStore(db, password, {
  onChange: (docs) => console.log('Changed:', docs.length),
  onDelete: (docs) => console.log('Deleted:', docs.length),
  onSync: (info) => {
    if (info.direction === 'push') {
      console.log(`Pushed ${info.change.docs_written} docs to server`);
    } else {
      console.log(`Pulled ${info.change.docs_read} docs from server`);
    }
  }
});
```

## Deployment Options

### Free Tier Options

1. **IBM Cloudant** - Free tier: 1GB storage, 20 req/sec
   ```typescript
   // Option 1: Continuous sync (may hit rate limits on initial sync)
   await store.connectRemote({
     url: 'https://username:password@username.cloudant.com/mydb'
   });

   // Option 2: Manual sync control (recommended for rate-limited services)
   await store.connectRemote({
     url: 'https://username:password@username.cloudant.com/mydb',
     live: false,
     retry: false
   });
   // Trigger sync manually when needed
   await store.syncNow();
   ```

2. **Oracle Cloud Free Tier** - Run your own CouchDB
   ```bash
   # On Oracle VM
   docker run -d -p 5984:5984 -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=password couchdb
   ```

3. **Self-hosted** - CouchDB on any VPS ($5/month)
   ```typescript
   await store.connectRemote({
     url: 'http://admin:password@your-server.com:5984/mydb'
   });
   ```

### Backup Strategy

Example using Oracle Free Tier + S3:

```bash
# Daily backup script
#!/bin/bash
TODAY=$(date +%Y-%m-%d)
curl -X GET http://admin:password@localhost:5984/mydb/_all_docs?include_docs=true > backup-$TODAY.json
aws s3 cp backup-$TODAY.json s3://my-backups/couchdb/
```

## Example: React Integration

```typescript
import { useState, useEffect } from 'react';
import PouchDBModule from 'pouchdb-browser';
const PouchDB = PouchDBModule.default || PouchDBModule;
import { EncryptedStore } from '@mrbelloc/encrypted-store';

function useEncryptedStore(dbName: string, password: string) {
  const [expenses, setExpenses] = useState<Map<string, any>>(new Map());
  const [store, setStore] = useState<EncryptedStore | null>(null);

  useEffect(() => {
    const db = new PouchDB(dbName);
    const encryptedStore = new EncryptedStore(db, password, {
      onChange: (docs) => {
        setExpenses((prev) => {
          const next = new Map(prev);
          docs.forEach((doc) => {
            if (doc._table === 'expenses') {
              next.set(doc._id, doc);
            }
          });
          return next;
        });
      },
      onDelete: (docs) => {
        setExpenses((prev) => {
          const next = new Map(prev);
          docs.forEach((doc) => {
            if (doc._table === 'expenses') {
              next.delete(doc._id);
            }
          });
          return next;
        });
      },
      onConflict: (conflicts) => {
        // Auto-resolve: pick latest by timestamp
        conflicts.forEach(async (conflict) => {
          const latest = [conflict.winner, ...conflict.losers]
            .sort((a, b) => b.timestamp - a.timestamp)[0];
          await encryptedStore.resolveConflict(conflict.table, conflict.id, latest);
        });
      }
    });

    encryptedStore.loadAll();
    setStore(encryptedStore);

    return () => {
      encryptedStore.disconnectRemote();
    };
  }, [dbName, password]);

  return { expenses: Array.from(expenses.values()), store };
}

function App() {
  const { expenses, store } = useEncryptedStore('myapp', 'my-password');

  const addExpense = async () => {
    await store?.put('expenses', {
      _id: crypto.randomUUID(),
      amount: 25,
      description: 'Coffee',
      timestamp: Date.now()
    });
  };

  return (
    <div>
      <button onClick={addExpense}>Add Expense</button>
      <ul>
        {expenses.map((exp) => (
          <li key={exp._id}>{exp.description}: ${exp.amount}</li>
        ))}
      </ul>
    </div>
  );
}
```

## TypeScript Types

```typescript
interface Doc {
  _id: string;
  _table: string;
  [key: string]: any;
}

interface ConflictInfo {
  docId: string;
  table: string;
  id: string;
  currentRev: string;
  conflictRevs: string[];
  winner: Doc;
  losers: Doc[];
}

interface SyncInfo {
  direction: 'push' | 'pull' | 'both';
  change: {
    docs_read?: number;
    docs_written?: number;
    doc_write_failures?: number;
    errors?: any[];
  };
}

interface DecryptionErrorEvent {
  docId: string;
  error: Error;
  rawDoc: any;
}

interface RemoteOptions {
  url: string;
  live?: boolean;
  retry?: boolean;
}

interface EncryptedStoreOptions {
  passphraseMode?: "derive" | "raw";
}
```

## How It Works

1. **Encryption**: Documents are encrypted with AES-256-GCM before storage
2. **Storage**: Encrypted data stored in PouchDB (IndexedDB in browser, LevelDB in Node)
3. **Change Detection**: PouchDB's changes feed notifies of all changes
4. **Conflict Detection**: PouchDB's MVCC detects conflicts automatically
5. **Sync**: Bi-directional sync with CouchDB using PouchDB replication
6. **Events**: Callbacks notify your app of changes, conflicts, and sync progress

## Browser vs Node.js

### Browser (Vite/Webpack)
- Use `pouchdb-browser@^8.0.1` - includes IndexedDB adapter
- Smaller bundle size
- Works with Vite, Webpack, etc.
- **Vite users**: 
  - Add `define: { global: 'globalThis' }` to vite.config.ts (PouchDB v8 requirement)
  - Install `events` package: `npm install events` (fixes "Class extends" errors)
- **Import**: Use `const PouchDB = PouchDBModule.default || PouchDBModule` for better compatibility

### Node.js
- Use `pouchdb` - includes LevelDB adapter
- For CLI tools, servers, etc.

## Security Notes

- Encryption happens client-side before any data leaves the device
- Remote servers only see encrypted blobs
- Password is never transmitted or stored
- Use a strong password (consider using a key derivation function like PBKDF2)

## License

MIT

## Why PouchDB?

- **Mature**: 10+ years of production use
- **Reliable**: Battle-tested conflict resolution
- **Compatible**: Works with any CouchDB server
- **Offline-first**: Built for unreliable networks
- **Simple**: Easy to understand replication model
- **Free**: No vendor lock-in, self-hostable