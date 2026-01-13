/**
 * Encrypted storage with change detection for small datasets in PWAs
 * Built on Fireproof with AES-256-GCM encryption
 * @packageDocumentation
 */

export { EncryptedStore } from "./encryptedStore.js";
export type {
  StoreListener,
  FireproofDb,
  TableEvent,
  DecryptionErrorEvent,
  ConnectorFunction,
  RemoteConnectOptions,
  SyncConnection,
} from "./encryptedStore";

export { EncryptionHelper, DecryptionError } from "./encryption.js";
export type { CryptoInterface } from "./encryption.js";

export const VERSION = "0.3.0";
export { fireproof } from "use-fireproof";
