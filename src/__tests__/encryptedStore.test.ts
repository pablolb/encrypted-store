/**
 * Tests for EncryptedStore with PouchDB
 */

import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import PouchDB from "pouchdb";
import MemoryAdapter from "pouchdb-adapter-memory";
import { EncryptedStore } from "../encryptedStore.js";
import type {
  Doc,
  ConflictInfo,
  SyncInfo,
  DecryptionErrorEvent,
} from "../encryptedStore.js";

// Use memory adapter for tests
PouchDB.plugin(MemoryAdapter);

describe("EncryptedStore", () => {
  let db: PouchDB.Database;
  let store: EncryptedStore;

  beforeEach(() => {
    db = new PouchDB("test-db", { adapter: "memory" });
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("Basic Operations", () => {
    test("should create store and load empty database", async () => {
      const onChange = jest.fn();
      store = new EncryptedStore(db, "test-password", {
        onChange,
        onDelete: jest.fn(),
      });
      await store.loadAll();
      expect(onChange).not.toHaveBeenCalled();
    });

    test("should put and get a document", async () => {
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
      });
      await store.loadAll();

      const doc = await store.put("expenses", {
        _id: "lunch",
        amount: 15.5,
        description: "Lunch",
      });

      expect(doc._id).toBe("lunch");
      expect(doc._table).toBe("expenses");
      expect(doc.amount).toBe(15.5);

      const retrieved = await store.get("expenses", "lunch");
      expect(retrieved).toEqual({
        _id: "lunch",
        _table: "expenses",
        amount: 15.5,
        description: "Lunch",
      });
    });

    test("should auto-generate ID if not provided", async () => {
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
      });
      await store.loadAll();

      const doc = await store.put("expenses", {
        amount: 20,
        description: "Dinner",
      });

      expect(doc._id).toBeDefined();
      expect(doc._id.length).toBeGreaterThan(0);

      const retrieved = await store.get("expenses", doc._id);
      expect(retrieved?.amount).toBe(20);
    });

    test("should update existing document", async () => {
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
      });
      await store.loadAll();

      await store.put("expenses", { _id: "lunch", amount: 15 });
      await store.put("expenses", { _id: "lunch", amount: 20 });

      const retrieved = await store.get("expenses", "lunch");
      expect(retrieved?.amount).toBe(20);
    });

    test("should delete a document", async () => {
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
      });
      await store.loadAll();

      await store.put("expenses", { _id: "lunch", amount: 15 });
      await store.delete("expenses", "lunch");

      const retrieved = await store.get("expenses", "lunch");
      expect(retrieved).toBeNull();
    });

    test("should return null for non-existent document", async () => {
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
      });
      await store.loadAll();

      const retrieved = await store.get("expenses", "nonexistent");
      expect(retrieved).toBeNull();
    });

    test("should get all documents", async () => {
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
      });
      await store.loadAll();

      await store.put("expenses", { _id: "lunch", amount: 15 });
      await store.put("expenses", { _id: "dinner", amount: 25 });
      await store.put("tasks", { _id: "task1", title: "Review" });

      const allDocs = await store.getAll();
      expect(allDocs.length).toBe(3);

      const expenses = await store.getAll("expenses");
      expect(expenses.length).toBe(2);
      expect(expenses.every((doc) => doc._table === "expenses")).toBe(true);

      const tasks = await store.getAll("tasks");
      expect(tasks.length).toBe(1);
      expect(tasks[0]._table).toBe("tasks");
    });
  });

  describe("Change Detection", () => {
    test("should trigger onChange when document is added", async () => {
      const onChange = jest.fn();
      store = new EncryptedStore(db, "test-password", {
        onChange,
        onDelete: jest.fn(),
      });
      await store.loadAll();

      await store.put("expenses", { _id: "lunch", amount: 15 });

      await waitFor(() => expect(onChange).toHaveBeenCalled());

      const calls = onChange.mock.calls;
      const lastCall = calls[calls.length - 1][0] as Doc[];
      expect(lastCall[0]._id).toBe("lunch");
      expect(lastCall[0]._table).toBe("expenses");
      expect(lastCall[0].amount).toBe(15);
    });

    test("should trigger onChange when document is updated", async () => {
      const onChange = jest.fn();
      store = new EncryptedStore(db, "test-password", {
        onChange,
        onDelete: jest.fn(),
      });
      await store.loadAll();

      await store.put("expenses", { _id: "lunch", amount: 15 });
      await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

      onChange.mockClear();
      await store.put("expenses", { _id: "lunch", amount: 20 });
      await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

      const lastCall = onChange.mock.calls[0][0] as Doc[];
      expect(lastCall[0].amount).toBe(20);
    });

    test("should trigger onDelete when document is deleted", async () => {
      const onDelete = jest.fn();
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete,
      });
      await store.loadAll();

      await store.put("expenses", { _id: "lunch", amount: 15 });
      await waitFor(() => expect(onDelete).not.toHaveBeenCalled());

      await store.delete("expenses", "lunch");
      await waitFor(() => expect(onDelete).toHaveBeenCalled());

      const deletedDocs = onDelete.mock.calls[0][0] as Doc[];
      expect(deletedDocs[0]._id).toBe("lunch");
      expect(deletedDocs[0]._table).toBe("expenses");
    });

    test("should load existing documents on loadAll", async () => {
      // Create some documents directly in PouchDB
      const helper = new (await import("../encryption.js")).EncryptionHelper(
        "test-password",
      );
      await db.put({
        _id: "expenses_lunch",
        d: await helper.encrypt(JSON.stringify({ amount: 15 })),
      });

      const onChange = jest.fn();
      store = new EncryptedStore(db, "test-password", {
        onChange,
        onDelete: jest.fn(),
      });
      await store.loadAll();

      expect(onChange).toHaveBeenCalled();
      const docs = onChange.mock.calls[0][0] as Doc[];
      expect(docs[0]._id).toBe("lunch");
      expect(docs[0]._table).toBe("expenses");
      expect(docs[0].amount).toBe(15);
    });
  });

  describe("Encryption", () => {
    test("should encrypt data before storing in PouchDB", async () => {
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
      });
      await store.loadAll();

      await store.put("expenses", { _id: "lunch", amount: 15, secret: "data" });

      // Get raw document from PouchDB
      const rawDoc = (await db.get("expenses_lunch")) as any;
      expect(rawDoc.d).toBeDefined();
      expect(typeof rawDoc.d).toBe("string");
      expect(rawDoc.d).toContain("|"); // encrypted format: iv|ciphertext
      expect(rawDoc.amount).toBeUndefined();
      expect(rawDoc.secret).toBeUndefined();
    });

    test("should fail to decrypt with wrong password", async () => {
      const helper = new (await import("../encryption.js")).EncryptionHelper(
        "correct-password",
      );
      await db.put({
        _id: "expenses_lunch",
        d: await helper.encrypt(JSON.stringify({ amount: 15 })),
      });

      const onError = jest.fn();
      store = new EncryptedStore(db, "wrong-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
        onError,
      });
      await store.loadAll();

      expect(onError).toHaveBeenCalled();
      const errors = onError.mock.calls[0][0] as DecryptionErrorEvent[];
      expect(errors[0].docId).toBe("expenses_lunch");
      expect(errors[0].error.name).toBe("DecryptionError");
    });

    test("should handle corrupted encrypted data", async () => {
      await db.put({
        _id: "expenses_lunch",
        d: "invalid-encrypted-data",
      });

      const onError = jest.fn();
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
        onError,
      });
      await store.loadAll();

      expect(onError).toHaveBeenCalled();
      const errors = onError.mock.calls[0][0] as DecryptionErrorEvent[];
      expect(errors[0].docId).toBe("expenses_lunch");
    });
  });

  describe("Conflict Detection", () => {
    test("should have onConflict callback available", async () => {
      const onConflict = jest.fn();
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
        onConflict,
      });
      await store.loadAll();

      // Just verify the callback is registered
      expect(onConflict).not.toHaveBeenCalled();

      // Create a document normally
      await store.put("expenses", { _id: "lunch", amount: 15 });
      const doc = await store.get("expenses", "lunch");
      expect(doc?.amount).toBe(15);
    });

    test("should expose resolveConflict method", async () => {
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
      });
      await store.loadAll();

      // Verify the method exists
      expect(typeof store.resolveConflict).toBe("function");
    });

    test("should check for conflicts with getConflictInfo", async () => {
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
      });
      await store.loadAll();

      // Create a document
      await store.put("expenses", { _id: "lunch", amount: 15 });

      // Check for conflicts (should be none)
      const conflictInfo = await store.getConflictInfo("expenses", "lunch");
      expect(conflictInfo).toBeNull();
    });

    test("should return null for non-existent document in getConflictInfo", async () => {
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
      });
      await store.loadAll();

      const conflictInfo = await store.getConflictInfo(
        "expenses",
        "nonexistent",
      );
      expect(conflictInfo).toBeNull();
    });
  });

  describe("Multiple Tables", () => {
    test("should handle multiple document types", async () => {
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
      });
      await store.loadAll();

      await store.put("expenses", { _id: "lunch", amount: 15 });
      await store.put("tasks", { _id: "task1", title: "Review" });
      await store.put("notes", { _id: "note1", text: "Meeting notes" });

      const expense = await store.get("expenses", "lunch");
      const task = await store.get("tasks", "task1");
      const note = await store.get("notes", "note1");

      expect(expense?._table).toBe("expenses");
      expect(task?._table).toBe("tasks");
      expect(note?._table).toBe("notes");

      const allDocs = await store.getAll();
      expect(allDocs.length).toBe(3);
    });

    test("should not mix documents from different tables", async () => {
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
      });
      await store.loadAll();

      await store.put("expenses", { _id: "lunch", amount: 15 });
      await store.put("tasks", { _id: "lunch", title: "Lunch meeting" });

      const expense = await store.get("expenses", "lunch");
      const task = await store.get("tasks", "lunch");

      expect(expense?.amount).toBe(15);
      expect(expense?.title).toBeUndefined();

      expect(task?.title).toBe("Lunch meeting");
      expect(task?.amount).toBeUndefined();
    });
  });

  describe("Sync Events", () => {
    test("should emit sync events when syncing", async () => {
      const onSync = jest.fn();
      const remoteDb = new PouchDB("remote-test-db", { adapter: "memory" });

      try {
        store = new EncryptedStore(db, "test-password", {
          onChange: jest.fn(),
          onDelete: jest.fn(),
          onSync,
        });
        await store.loadAll();

        await store.put("expenses", { _id: "lunch", amount: 15 });

        // Connect to remote (in-memory, so instant)
        await store.connectRemote({
          url: remoteDb as any,
          live: false, // Don't use live sync in tests
          retry: false,
        });

        // Wait for sync to complete
        await waitFor(() => expect(onSync).toHaveBeenCalled(), 3000);

        const syncInfo = onSync.mock.calls[0][0] as SyncInfo;
        expect(syncInfo.direction).toBeDefined();
        expect(syncInfo.change).toBeDefined();
      } finally {
        store.disconnectRemote();
        await remoteDb.destroy();
      }
    });
  });

  describe("Edge Cases", () => {
    test("should handle documents with special characters", async () => {
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
      });
      await store.loadAll();

      await store.put("expenses", {
        _id: "special",
        description: "Café ☕ 日本語 émojis 🎉",
        amount: 15,
      });

      const retrieved = await store.get("expenses", "special");
      expect(retrieved?.description).toBe("Café ☕ 日本語 émojis 🎉");
    });

    test("should handle large documents", async () => {
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
      });
      await store.loadAll();

      const largeText = "x".repeat(10000);
      await store.put("notes", {
        _id: "large",
        text: largeText,
      });

      const retrieved = await store.get("notes", "large");
      expect(retrieved?.text).toBe(largeText);
      expect(retrieved?.text.length).toBe(10000);
    });

    test("should handle nested objects", async () => {
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
      });
      await store.loadAll();

      const complexDoc = {
        _id: "complex",
        nested: {
          level1: {
            level2: {
              value: "deep",
            },
          },
        },
        array: [1, 2, { key: "value" }],
      };

      await store.put("data", complexDoc);
      const retrieved = await store.get("data", "complex");

      expect(retrieved?.nested.level1.level2.value).toBe("deep");
      expect(retrieved?.array[2].key).toBe("value");
    });

    test("should not store internal fields", async () => {
      store = new EncryptedStore(db, "test-password", {
        onChange: jest.fn(),
        onDelete: jest.fn(),
      });
      await store.loadAll();

      await store.put("expenses", {
        _id: "lunch",
        amount: 15,
        _someInternal: "should not be stored",
      });

      const retrieved = await store.get("expenses", "lunch");
      expect(retrieved?.amount).toBe(15);
      expect(retrieved?._someInternal).toBeUndefined();
    });
  });
});

// Helper function to wait for async conditions
function waitFor(
  condition: () => boolean | void,
  timeout: number = 1000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      try {
        const result = condition();
        if (result !== false) {
          resolve();
          return;
        }
      } catch (error) {
        // Condition not met yet
      }

      if (Date.now() - startTime > timeout) {
        reject(new Error("Timeout waiting for condition"));
        return;
      }

      setTimeout(check, 50);
    };

    check();
  });
}
