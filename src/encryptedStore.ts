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

/**
 * Options for configuring the EncryptedStore
 */
export interface EncryptedStoreOptions {
  /**
   * Key derivation mode for the passphrase.
   *
   * - `"derive"` (default): Use PBKDF2 with 100k iterations for user passphrases.
   *   Recommended for production use. Provides strong protection against brute-force
   *   and dictionary attacks. First unlock will take ~50-100ms.
   *
   * - `"raw"`: Use SHA-256 only. For pre-derived keys or advanced users who handle
   *   key derivation themselves. Allows full control over KDF algorithm, iterations,
   *   and progress UI.
   *
   * @default "derive"
   */
  passphraseMode?: "derive" | "raw";
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
  private remoteUrl: string | null = null;
  private processingChain: Promise<void> = Promise.resolve();

  constructor(
    db: PouchDB.Database,
    password: string,
    listener?: StoreListener,
    options?: EncryptedStoreOptions,
  ) {
    this.db = db;
    this.encryptionHelper = new EncryptionHelper(
      password,
      undefined,
      options?.passphraseMode || "derive",
    );
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

  /**
   * Delete all documents locally only.
   * Automatically disconnects sync first to prevent deletions from propagating to remote.
   * Use this when you want to clear local data only.
   */
  async deleteAllLocal(): Promise<void> {
    // Disconnect sync to ensure deletions stay local
    this.disconnectRemote();

    const result = await this.db.allDocs({ include_docs: false });

    const docsToDelete = result.rows
      .filter((row) => !row.id.startsWith("_design/"))
      .map((row) => ({
        _id: row.id,
        _rev: row.value.rev,
        _deleted: true,
      }));

    if (docsToDelete.length > 0) {
      await this.db.bulkDocs(docsToDelete);
    }
  }

  /**
   * Delete all documents locally AND propagate deletions to remote.
   * Waits for sync to complete before returning.
   * Throws an error if sync is not connected.
   */
  async deleteAllAndSync(): Promise<void> {
    if (!this.syncHandler) {
      throw new Error(
        "Sync is not connected. Call connectRemote() first or use deleteAllLocal() instead.",
      );
    }

    const result = await this.db.allDocs({ include_docs: false });

    const docsToDelete = result.rows
      .filter((row) => !row.id.startsWith("_design/"))
      .map((row) => ({
        _id: row.id,
        _rev: row.value.rev,
        _deleted: true,
      }));

    if (docsToDelete.length === 0) {
      return; // Nothing to delete
    }

    // Delete all documents
    await this.db.bulkDocs(docsToDelete);

    // Wait for sync to propagate deletions
    return new Promise<void>((resolve, reject) => {
      let changeCount = 0;
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error("Timeout waiting for deletions to sync to remote"));
        }
      }, 30000); // 30 second timeout

      const changeHandler = (info: any) => {
        if (info.direction === "push") {
          changeCount += info.change.docs_written || 0;

          // Wait until all deletions have been pushed
          if (changeCount >= docsToDelete.length && !resolved) {
            clearTimeout(timeout);
            resolved = true;
            this.syncHandler?.removeListener("change", changeHandler);
            this.syncHandler?.removeListener("error", errorHandler);
            resolve();
          }
        }
      };

      const errorHandler = (err: any) => {
        if (!resolved) {
          clearTimeout(timeout);
          resolved = true;
          this.syncHandler?.removeListener("change", changeHandler);
          this.syncHandler?.removeListener("error", errorHandler);
          reject(err);
        }
      };

      this.syncHandler!.on("change", changeHandler);
      this.syncHandler!.on("error", errorHandler);
    });
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

    this.remoteUrl = options.url;

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
    this.remoteUrl = null;
  }

  /**
   * Trigger an immediate one-time sync with the remote.
   * Requires that connectRemote() has been called first.
   * Returns a promise that resolves when the sync completes.
   */
  async syncNow(): Promise<void> {
    if (!this.remoteUrl) {
      throw new Error(
        "No remote connection configured. Call connectRemote() first.",
      );
    }

    return new Promise<void>((resolve, reject) => {
      const sync = this.db.sync(this.remoteUrl!, {
        live: false,
        retry: false,
      });

      sync
        .on("complete", (info) => {
          if (this.listener.onSync) {
            // Fire onSync for both push and pull if they occurred
            if (info.push && info.push.docs_written !== undefined) {
              this.listener.onSync({
                direction: "push",
                change: {
                  docs_read: info.push.docs_read,
                  docs_written: info.push.docs_written,
                  doc_write_failures: info.push.doc_write_failures,
                  errors: info.push.errors,
                },
              });
            }
            if (info.pull && info.pull.docs_written !== undefined) {
              this.listener.onSync({
                direction: "pull",
                change: {
                  docs_read: info.pull.docs_read,
                  docs_written: info.pull.docs_written,
                  doc_write_failures: info.pull.doc_write_failures,
                  errors: info.pull.errors,
                },
              });
            }
          }
          resolve();
        })
        .on("error", (err) => {
          console.error("[EncryptedStore] syncNow error:", err);
          reject(err);
        });
    });
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
