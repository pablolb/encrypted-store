/**
 * Encrypted storage with change detection using PouchDB
 * Simple API with AES-256-GCM encryption
 * @packageDocumentation
 */

export { EncryptedStore } from "./encryptedStore.js";
export type {
  Doc,
  StoreListener,
  DecryptionErrorEvent,
  ConflictInfo,
  SyncInfo,
  RemoteOptions,
  EncryptedStoreOptions,
} from "./encryptedStore.js";

export { EncryptionHelper, DecryptionError } from "./encryption.js";
export type { CryptoInterface } from "./encryption.js";

export const VERSION = "2.0.0";

// Re-export PouchDB for convenience
// Use pouchdb-browser for Vite/browser compatibility
import PouchDB from "pouchdb-browser";
export { PouchDB };
