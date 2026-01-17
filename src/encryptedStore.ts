/**
 * Encrypted storage with change detection using PouchDB
 * Simple API: put, get, delete, loadAll
 */

import { EncryptionHelper } from "./encryption.js";
import type PouchDB from "pouchdb";

export interface Doc {
  _id: string;
  _table: string;
  [key: string]: any;
}

export interface DecryptionErrorEvent {
  docId: string;
  error: Error;
  rawDoc: any;
}

export interface ConflictInfo {
  docId: string;
  table: string;
  id: string;
  currentRev: string;
  conflictRevs: string[];
  winner: Doc;
  losers: Doc[];
}

export interface SyncInfo {
  direction: "push" | "pull" | "both";
  change: {
    docs_read?: number;
    docs_written?: number;
    doc_write_failures?: number;
    errors?: any[];
  };
}

export interface StoreListener {
  onChange: (docs: Doc[]) => void;
  onDelete: (docs: Doc[]) => void;
  onConflict?: (conflicts: ConflictInfo[]) => void;
  onSync?: (info: SyncInfo) => void;
  onError?: (errors: DecryptionErrorEvent[]) => void;
}

export interface RemoteOptions {
  url: string;
  live?: boolean;
  retry?: boolean;
}

interface EncryptedDoc {
  _id: string;
  _rev?: string;
  d: string;
}

export class EncryptedStore {
  private db: PouchDB.Database;
  private encryptionHelper: EncryptionHelper;
  private listener: StoreListener;
  private changesHandler: PouchDB.Core.Changes<any> | null = null;
  private syncHandler: PouchDB.Replication.Sync<any> | null = null;
  private processingChain: Promise<void> = Promise.resolve();

  constructor(
    db: PouchDB.Database,
    password: string,
    listener?: StoreListener,
  ) {
    this.db = db;
    this.encryptionHelper = new EncryptionHelper(password);
    this.listener = listener || { onChange: () => {}, onDelete: () => {} };
  }

  /** Load all documents and set up change detection */
  async loadAll(): Promise<void> {
    try {
      const result = await this.db.allDocs({
        include_docs: true,
        conflicts: true,
      });

      const docs: Doc[] = [];
      const errors: DecryptionErrorEvent[] = [];
      const conflicts: ConflictInfo[] = [];

      for (const row of result.rows) {
        if (!row.doc || row.id.startsWith("_design/")) continue;

        const encryptedDoc = row.doc as EncryptedDoc & {
          _conflicts?: string[];
        };

        if (encryptedDoc.d) {
          try {
            const doc = await this.decryptDoc(encryptedDoc);
            docs.push(doc);

            // Check for conflicts
            if (encryptedDoc._conflicts && encryptedDoc._conflicts.length > 0) {
              const conflictInfo = await this.buildConflictInfo(
                encryptedDoc._id,
                encryptedDoc._rev!,
                encryptedDoc._conflicts,
                doc,
              );
              conflicts.push(conflictInfo);
            }
          } catch (error) {
            errors.push({
              docId: encryptedDoc._id,
              error: error instanceof Error ? error : new Error(String(error)),
              rawDoc: encryptedDoc,
            });
          }
        }
      }

      if (docs.length > 0) {
        this.listener.onChange(docs);
      }
      if (errors.length > 0 && this.listener.onError) {
        this.listener.onError(errors);
      }
      if (conflicts.length > 0 && this.listener.onConflict) {
        this.listener.onConflict(conflicts);
      }
    } catch (error) {
      console.error("[EncryptedStore] loadAll failed:", error);
    }

    this.setupSubscription();
  }

  /** Create or update a document */
  async put(table: string, doc: any): Promise<Doc> {
    if (!doc._id) {
      doc._id =
        crypto.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    const fullId = `${table}_${doc._id}`;
    const encryptedDoc = await this.encryptDoc(doc, fullId);

    // Preserve _rev if document exists
    try {
      const existing = await this.db.get(fullId);
      encryptedDoc._rev = existing._rev;
    } catch {
      // Document doesn't exist, that's fine
    }

    await this.db.put(encryptedDoc);

    return { ...doc, _table: table };
  }

  /** Get a document by table and id */
  async get(table: string, id: string): Promise<Doc | null> {
    try {
      const fullId = `${table}_${id}`;
      const encryptedDoc = (await this.db.get(fullId, {
        conflicts: true,
      })) as EncryptedDoc & { _conflicts?: string[] };

      const doc = await this.decryptDoc(encryptedDoc);

      // Notify about conflicts if present
      if (
        encryptedDoc._conflicts &&
        encryptedDoc._conflicts.length > 0 &&
        this.listener.onConflict
      ) {
        const conflictInfo = await this.buildConflictInfo(
          encryptedDoc._id,
          encryptedDoc._rev!,
          encryptedDoc._conflicts,
          doc,
        );
        this.listener.onConflict([conflictInfo]);
      }

      return doc;
    } catch {
      return null;
    }
  }

  /** Delete a document */
  async delete(table: string, id: string): Promise<void> {
    const fullId = `${table}_${id}`;
    try {
      const doc = await this.db.get(fullId);
      await this.db.remove(doc);
    } catch (error) {
      console.warn(`[EncryptedStore] Could not delete ${fullId}:`, error);
    }
  }

  /** Get all documents (optionally filtered by table) */
  async getAll(table?: string): Promise<Doc[]> {
    const result = await this.db.allDocs({
      include_docs: true,
      conflicts: true,
    });

    const docs: Doc[] = [];
    const errors: DecryptionErrorEvent[] = [];

    for (const row of result.rows) {
      if (!row.doc || row.id.startsWith("_design/")) continue;

      const encryptedDoc = row.doc as EncryptedDoc;

      if (encryptedDoc.d) {
        try {
          const doc = await this.decryptDoc(encryptedDoc);
          if (!table || doc._table === table) {
            docs.push(doc);
          }
        } catch (error) {
          errors.push({
            docId: encryptedDoc._id,
            error: error instanceof Error ? error : new Error(String(error)),
            rawDoc: encryptedDoc,
          });
        }
      }
    }

    if (errors.length > 0 && this.listener.onError) {
      this.listener.onError(errors);
    }

    return docs;
  }

  /** Connect to remote CouchDB for sync */
  async connectRemote(options: RemoteOptions): Promise<void> {
    this.disconnectRemote();

    const syncOptions: PouchDB.Replication.SyncOptions = {
      live: options.live ?? true,
      retry: options.retry ?? true,
    };

    this.syncHandler = this.db.sync(options.url, syncOptions);

    // Setup sync event listeners
    if (this.listener.onSync) {
      this.syncHandler
        .on("change", (info) => {
          if (this.listener.onSync) {
            this.listener.onSync({
              direction: info.direction as "push" | "pull",
              change: info.change,
            });
          }
        })
        .on("error", (err) => {
          console.error("[EncryptedStore] sync error:", err);
        });
    }

    // Wait for initial sync to start
    return new Promise<void>((resolve, reject) => {
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, 5000);

      this.syncHandler!.on("active", () => {
        if (!resolved) {
          clearTimeout(timeout);
          resolved = true;
          resolve();
        }
      });

      this.syncHandler!.on("error", (err) => {
        if (!resolved) {
          clearTimeout(timeout);
          resolved = true;
          reject(err);
        }
      });
    });
  }

  /** Disconnect from remote sync */
  disconnectRemote(): void {
    if (this.syncHandler) {
      this.syncHandler.cancel();
      this.syncHandler = null;
    }
  }

  /** Resolve a conflict by choosing the winner */
  async resolveConflict(
    table: string,
    id: string,
    winningDoc: Doc,
  ): Promise<void> {
    const fullId = `${table}_${id}`;

    const doc = (await this.db.get(fullId, { conflicts: true })) as any;

    if (!doc._conflicts || doc._conflicts.length === 0) {
      throw new Error(`No conflicts found for ${fullId}`);
    }

    // Update with winning document
    await this.put(table, winningDoc);

    // Remove all conflicting revisions
    for (const rev of doc._conflicts) {
      try {
        await this.db.remove(fullId, rev);
      } catch (error) {
        console.warn(`Failed to remove conflict ${fullId}@${rev}:`, error);
      }
    }
  }

  /** Check if a document has conflicts without triggering the callback */
  async getConflictInfo(
    table: string,
    id: string,
  ): Promise<ConflictInfo | null> {
    try {
      const fullId = `${table}_${id}`;
      const encryptedDoc = (await this.db.get(fullId, {
        conflicts: true,
      })) as EncryptedDoc & { _conflicts?: string[] };

      if (!encryptedDoc._conflicts || encryptedDoc._conflicts.length === 0) {
        return null;
      }

      const doc = await this.decryptDoc(encryptedDoc);

      return await this.buildConflictInfo(
        encryptedDoc._id,
        encryptedDoc._rev!,
        encryptedDoc._conflicts,
        doc,
      );
    } catch {
      return null;
    }
  }

  /** Re-subscribe to changes (useful after disconnect/reconnect) */
  reconnect(): void {
    if (this.changesHandler) {
      this.changesHandler.cancel();
      this.changesHandler = null;
    }
    this.setupSubscription();
  }

  private setupSubscription(): void {
    this.changesHandler = this.db
      .changes({
        since: "now",
        live: true,
        include_docs: true,
        conflicts: true,
      })
      .on("change", (change) => {
        this.processingChain = this.processingChain
          .then(() => this.handleChange(change))
          .catch((err) =>
            console.error("[EncryptedStore] handleChange error:", err),
          );
      })
      .on("error", (err) => {
        console.error("[EncryptedStore] changes feed error:", err);
      });
  }

  private async handleChange(
    change: PouchDB.Core.ChangesResponseChange<any>,
  ): Promise<void> {
    if (change.id.startsWith("_design/")) return;

    const encryptedDoc = change.doc as
      | (EncryptedDoc & { _conflicts?: string[] })
      | undefined;

    // Deletion
    if (change.deleted || !encryptedDoc?.d) {
      const parsed = this.parseFullId(change.id);
      if (parsed) {
        this.listener.onDelete([{ _id: parsed.id, _table: parsed.table }]);
      }
      return;
    }

    // Changed/added document
    const errors: DecryptionErrorEvent[] = [];
    const conflicts: ConflictInfo[] = [];

    try {
      const doc = await this.decryptDoc(encryptedDoc);

      // Check for conflicts
      if (encryptedDoc._conflicts && encryptedDoc._conflicts.length > 0) {
        const conflictInfo = await this.buildConflictInfo(
          encryptedDoc._id,
          encryptedDoc._rev!,
          encryptedDoc._conflicts,
          doc,
        );
        conflicts.push(conflictInfo);
      }

      this.listener.onChange([doc]);
    } catch (error) {
      errors.push({
        docId: encryptedDoc._id,
        error: error instanceof Error ? error : new Error(String(error)),
        rawDoc: encryptedDoc,
      });
    }

    if (errors.length > 0 && this.listener.onError) {
      this.listener.onError(errors);
    }
    if (conflicts.length > 0 && this.listener.onConflict) {
      this.listener.onConflict(conflicts);
    }
  }

  private async buildConflictInfo(
    fullId: string,
    currentRev: string,
    conflictRevs: string[],
    winnerDoc: Doc,
  ): Promise<ConflictInfo> {
    const parsed = this.parseFullId(fullId);
    if (!parsed) {
      throw new Error(`Invalid ID format: ${fullId}`);
    }

    const losers: Doc[] = [];
    const errors: DecryptionErrorEvent[] = [];

    for (const rev of conflictRevs) {
      try {
        const conflictDoc = (await this.db.get(fullId, {
          rev,
        })) as EncryptedDoc;
        const decrypted = await this.decryptDoc(conflictDoc);
        losers.push(decrypted);
      } catch (error) {
        errors.push({
          docId: `${fullId}@${rev}`,
          error: error instanceof Error ? error : new Error(String(error)),
          rawDoc: { _id: fullId, _rev: rev },
        });
      }
    }

    if (errors.length > 0 && this.listener.onError) {
      this.listener.onError(errors);
    }

    return {
      docId: fullId,
      table: parsed.table,
      id: parsed.id,
      currentRev,
      conflictRevs,
      winner: winnerDoc,
      losers,
    };
  }

  private async decryptDoc(encryptedDoc: EncryptedDoc): Promise<Doc> {
    const parsed = this.parseFullId(encryptedDoc._id);
    if (!parsed) throw new Error(`Invalid ID format: ${encryptedDoc._id}`);

    const decrypted = JSON.parse(
      await this.encryptionHelper.decrypt(encryptedDoc.d),
    );
    return { _id: parsed.id, _table: parsed.table, ...decrypted };
  }

  private async encryptDoc(doc: any, fullId: string): Promise<EncryptedDoc> {
    const data: Record<string, any> = {};
    for (const [key, value] of Object.entries(doc)) {
      if (!key.startsWith("_")) {
        data[key] = value;
      }
    }

    return {
      _id: fullId,
      d: await this.encryptionHelper.encrypt(JSON.stringify(data)),
    };
  }

  private parseFullId(fullId: string): { table: string; id: string } | null {
    const idx = fullId.indexOf("_");
    if (idx === -1) return null;
    return { table: fullId.slice(0, idx), id: fullId.slice(idx + 1) };
  }
}
