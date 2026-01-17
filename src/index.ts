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
} from "./encryptedStore.js";

export { EncryptionHelper, DecryptionError } from "./encryption.js";
export type { CryptoInterface } from "./encryption.js";

export const VERSION = "1.3.1";

// Re-export PouchDB for convenience
// Use pouchdb-browser for Vite/browser compatibility
import PouchDB from "pouchdb-browser";
export { PouchDB };
