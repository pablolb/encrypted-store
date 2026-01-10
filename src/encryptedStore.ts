/**
 * Encrypted storage with change detection for small datasets
 * Wraps Fireproof with AES-256-GCM encryption + real-time event system
 */

import { EncryptionHelper } from "./encryption.js";

interface Doc {
  _id: string;
  [key: string]: any;
}

export interface TableEvent {
  table: string;
  docs: Doc[];
}

export interface StoreListener {
  docsAdded: (events: TableEvent[]) => void;
  docsChanged: (events: TableEvent[]) => void;
  docsDeleted: (events: TableEvent[]) => void;
}

export interface RemoteConnectOptions {
  namespace: string;
  host: string;
}

export interface SyncConnection {
  ready?: Promise<void>;
  disconnect?: () => void;
}

export type ConnectorFunction = (
  db: FireproofDb,
  namespace: string,
  host: string,
) => SyncConnection;

export interface FireproofDb {
  put(doc: any): Promise<{ id: string; rev?: string }>;
  get(id: string): Promise<any>;
  query(
    field: string,
    options?: { limit?: number; descending?: boolean },
  ): Promise<{
    docs?: any[];
    rows: Array<{ key: string; doc?: any; value?: any }>;
  }>;
  subscribe(callback: (changes: any[]) => void, remote?: boolean): void;
  del(id: string, rev?: string): Promise<any>;
}

/**
 * Document with encrypted data field
 */
interface EncryptedDoc {
  _id: string;
  d: string; // encrypted data
}

/**
 * EncryptedStore class
 *
 * Main entry point for encrypted storage with change detection
 */
export class EncryptedStore {
  private db: FireproofDb;
  private encryptionHelper: EncryptionHelper;
  private listener: StoreListener;
  private knownIds: Set<string> = new Set(); // Set of known document IDs (stripped, e.g., "alice")
  private fullIdMap: Map<string, string> = new Map(); // stripped id -> full id with table
  private isSubscribed: boolean = false;
  private connection: SyncConnection | null = null;

  constructor(db: FireproofDb, password: string, listener: StoreListener) {
    this.db = db;
    this.encryptionHelper = new EncryptionHelper(password);
    this.listener = listener;
  }

  /** Load all documents and set up change detection (call once after creating store) */
  async loadAll(): Promise<void> {
    const { encryptedMap, fullIdMap } = await this.readAllEncrypted();
    this.fullIdMap = fullIdMap;

    // Build initial set of known IDs
    this.knownIds = new Set(encryptedMap.keys());

    // Decrypt all documents for initial docsAdded event
    const docs: Doc[] = [];
    for (const [id, encryptedData] of encryptedMap) {
      try {
        const decrypted = await this.decryptFromEncryptedData(
          encryptedData,
          id,
        );
        docs.push(decrypted);
      } catch (error) {
        // Skip documents we can't decrypt
      }
    }

    // Fire initial docsAdded for everything, grouped by table
    if (docs.length > 0) {
      const events = this.groupByTable(docs, fullIdMap);
      this.listener.docsAdded(events);
    }

    // Set up subscribe (only once)
    if (!this.isSubscribed) {
      this.db.subscribe((changes) => {
        this.handleChange(changes).catch((err) => {
          console.error("EncryptedStore: Error handling change:", err);
        });
      }, true); // Include remote changes
      this.isSubscribed = true;
    }
  }

  /** Create or update a document */
  async put(type: string, doc: any): Promise<Doc> {
    // Generate ID if not provided
    if (!doc._id) {
      doc._id = this.generateId();
    }

    // Build full ID with type prefix
    const fullId = `${type}_${doc._id}`;

    // Encrypt the document
    const encryptedDoc = await this.encryptDoc(doc, fullId);

    // Store in Fireproof
    await this.db.put(encryptedDoc);

    // Fireproof's subscribe will trigger handleChange()
    // which will reload, compute diff, and fire events

    return doc;
  }

  /** Get a document (returns null if not found) */
  async get(type: string, id: string): Promise<Doc | null> {
    const fullId = `${type}_${id}`;
    try {
      const encryptedDoc = await this.db.get(fullId);
      return await this.decryptDoc(encryptedDoc, id);
    } catch (error) {
      // Document not found
      return null;
    }
  }

  /** Delete a document */
  async delete(type: string, id: string): Promise<void> {
    // Build full ID with type prefix
    const fullId = `${type}_${id}`;

    // Delete from Fireproof
    await this.db.del(fullId);

    // Fireproof's subscribe will trigger handleChange()
    // which will detect the deletion and fire docsDeleted event
  }

  /** Connect to remote sync with any Fireproof connector */
  async connectRemote(
    connector: ConnectorFunction,
    options: RemoteConnectOptions,
  ): Promise<void> {
    this.disconnectRemote();

    try {
      console.log(
        `[EncryptedStore] Connecting to ${options.host} with namespace: ${options.namespace}`,
      );

      // Call the connector function
      const connection = connector(this.db, options.namespace, options.host);

      // Store connection
      this.connection = {
        ready: connection.ready || Promise.resolve(),
        disconnect: connection.disconnect,
      };

      // Wait for connection to be ready
      await this.connection.ready;
      console.log(`[EncryptedStore] ✓ Connected to remote`);
    } catch (error) {
      console.error(`[EncryptedStore] ✗ Failed to connect:`, error);
      this.connection = null;
      throw error;
    }
  }

  /** Disconnect from remote sync */
  disconnectRemote(): void {
    if (this.connection && this.connection.disconnect) {
      this.connection.disconnect();
      console.log("[EncryptedStore] Disconnected from remote");
    }
    this.connection = null;
  }

  /** Read all encrypted documents (without decrypting) */
  private async readAllEncrypted(): Promise<{
    encryptedMap: Map<string, string>;
    fullIdMap: Map<string, string>;
  }> {
    const result = await this.db.query("_id", { descending: false });
    const encryptedMap = new Map<string, string>();
    const fullIdMap = new Map<string, string>();

    // Get docs from either result.docs or result.rows
    const allDocs =
      result.docs || result.rows.map((row) => row.doc).filter(Boolean);

    for (const doc of allDocs) {
      try {
        const { type, id } = this.parseFullId(doc._id);
        encryptedMap.set(id, doc.d); // Store encrypted data
        fullIdMap.set(id, doc._id); // Map "alice" -> "users_alice"
      } catch (error) {
        // Skip documents with invalid ID format
      }
    }

    return { encryptedMap, fullIdMap };
  }

  /**
   * Process Fireproof changes: { _id, d? }
   * With d = create/update, without d = deletion
   */
  private async handleChange(changes: any[]): Promise<void> {
    const newDocs: Doc[] = [];
    const changedDocs: Doc[] = [];
    const deletedDocs: Array<{ _id: string }> = [];

    for (const change of changes) {
      if (change.d) {
        // Has encrypted data - it's a create or update
        try {
          const { type, id } = this.parseFullId(change._id);

          // Decrypt the document
          const decrypted = await this.decryptFromEncryptedData(change.d, id);

          // Check if it's new or changed
          if (this.knownIds.has(id)) {
            changedDocs.push(decrypted);
          } else {
            newDocs.push(decrypted);
            this.knownIds.add(id);
            this.fullIdMap.set(id, change._id); // Update fullIdMap for new docs
          }
        } catch (error) {
          // Skip documents we can't decrypt or parse
        }
      } else {
        // No encrypted data - it's a deletion
        try {
          const { type, id } = this.parseFullId(change._id);

          if (this.knownIds.has(id)) {
            deletedDocs.push({ _id: id });
            this.knownIds.delete(id);
            // Keep fullIdMap entry for the deletion event, remove after
          }
        } catch (error) {
          // Skip invalid IDs
        }
      }
    }

    // Fire events grouped by table
    if (newDocs.length > 0) {
      const events = this.groupByTable(newDocs, this.fullIdMap);
      this.listener.docsAdded(events);
    }
    if (changedDocs.length > 0) {
      const events = this.groupByTable(changedDocs, this.fullIdMap);
      this.listener.docsChanged(events);
    }
    if (deletedDocs.length > 0) {
      const events = this.groupDeletedByTable(deletedDocs);
      this.listener.docsDeleted(events);

      // Clean up fullIdMap entries for deleted docs
      for (const doc of deletedDocs) {
        this.fullIdMap.delete(doc._id);
      }
    }
  }

  private async decryptFromEncryptedData(
    encryptedData: string,
    id: string,
  ): Promise<Doc> {
    // Decrypt the data
    const decryptedJson = await this.encryptionHelper.decrypt(encryptedData);
    const decryptedData = JSON.parse(decryptedJson);

    // Build final document
    const doc: Doc = {
      _id: id,
      ...decryptedData,
    };

    return doc;
  }

  private async encryptDoc(doc: any, fullId: string): Promise<EncryptedDoc> {
    // Extract fields to encrypt (everything except _id)
    const dataToEncrypt: any = {};
    for (const [key, value] of Object.entries(doc)) {
      if (!key.startsWith("_")) {
        dataToEncrypt[key] = value;
      }
    }

    // Encrypt as JSON
    const encrypted = await this.encryptionHelper.encrypt(
      JSON.stringify(dataToEncrypt),
    );

    // Build encrypted doc
    const encryptedDoc: EncryptedDoc = {
      _id: fullId,
      d: encrypted,
    };

    return encryptedDoc;
  }

  private async decryptDoc(encryptedDoc: any, id: string): Promise<Doc> {
    // Decrypt the 'd' field
    const decryptedJson = await this.encryptionHelper.decrypt(encryptedDoc.d);
    const decryptedData = JSON.parse(decryptedJson);

    // Build final document
    const doc: Doc = {
      _id: id,
      ...decryptedData,
    };

    return doc;
  }

  private parseFullId(fullId: string): { type: string; id: string } {
    const firstUnderscore = fullId.indexOf("_");
    if (firstUnderscore === -1) {
      throw new Error(`Invalid document ID format: ${fullId}`);
    }
    return {
      type: fullId.substring(0, firstUnderscore),
      id: fullId.substring(firstUnderscore + 1),
    };
  }

  private generateId(): string {
    // Use crypto.randomUUID if available, otherwise fallback
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for environments without crypto.randomUUID
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  private groupByTable(
    docs: Doc[],
    fullIdMap: Map<string, string>,
  ): TableEvent[] {
    const grouped = new Map<string, Doc[]>();

    for (const doc of docs) {
      const fullId = fullIdMap.get(doc._id);
      if (fullId) {
        const { type } = this.parseFullId(fullId);
        if (!grouped.has(type)) {
          grouped.set(type, []);
        }
        grouped.get(type)!.push(doc);
      }
    }

    return Array.from(grouped.entries()).map(([table, docs]) => ({
      table,
      docs,
    }));
  }

  private groupDeletedByTable(
    deletedDocs: Array<{ _id: string }>,
  ): TableEvent[] {
    const grouped = new Map<string, Array<{ _id: string }>>();

    for (const doc of deletedDocs) {
      const fullId = this.fullIdMap.get(doc._id);
      if (fullId) {
        const { type } = this.parseFullId(fullId);
        if (!grouped.has(type)) {
          grouped.set(type, []);
        }
        grouped.get(type)!.push(doc);
      }
    }

    return Array.from(grouped.entries()).map(([table, docs]) => ({
      table,
      docs: docs as any, // Cast since deletedDocs is simpler structure
    }));
  }
}
