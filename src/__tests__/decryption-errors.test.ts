import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { webcrypto } from "node:crypto";
import { fireproof } from "use-fireproof";
import { EncryptedStore, DecryptionErrorEvent } from "../encryptedStore";
import { EncryptionHelper } from "../encryption";

interface StoreListener {
  docsAdded: (events: any[]) => void;
  docsChanged: (events: any[]) => void;
  docsDeleted: (events: any[]) => void;
  decryptionError?: (events: DecryptionErrorEvent[]) => void;
}

describe("Decryption Error Handling", () => {
  let rawFireproof: any;
  let listener: StoreListener & { calls: any[] };

  beforeEach(() => {
    const testDbName = `test-db-${Date.now()}-${Math.random()}`;
    rawFireproof = fireproof(testDbName);

    // Track listener calls
    listener = {
      calls: [],
      docsAdded: (events: any[]) => {
        listener.calls.push({ type: "docsAdded", events });
      },
      docsChanged: (events: any[]) => {
        listener.calls.push({ type: "docsChanged", events });
      },
      docsDeleted: (events: any[]) => {
        listener.calls.push({ type: "docsDeleted", events });
      },
      decryptionError: (events: DecryptionErrorEvent[]) => {
        listener.calls.push({ type: "decryptionError", events });
      },
    };
  });

  afterEach(async () => {
    try {
      if (rawFireproof && rawFireproof.destroy) {
        await rawFireproof.destroy();
      }
    } catch (error) {
      console.warn("Error cleaning up test database:", error);
    }
  });

  it("should fire decryptionError event when loading documents encrypted with wrong password", async () => {
    // Pre-populate with documents encrypted with different passwords
    const encryptionHelper1 = new EncryptionHelper(
      "password1",
      webcrypto as any,
    );
    const encryptionHelper2 = new EncryptionHelper(
      "password2",
      webcrypto as any,
    );

    // Store two documents with password1
    const doc1Data = await encryptionHelper1.encrypt(
      JSON.stringify({ name: "Alice", age: 30 }),
    );
    const doc2Data = await encryptionHelper1.encrypt(
      JSON.stringify({ name: "Bob", age: 25 }),
    );

    // Store one document with password2 (wrong password)
    const doc3Data = await encryptionHelper2.encrypt(
      JSON.stringify({ name: "Charlie", age: 35 }),
    );

    await rawFireproof.put({ _id: "users_alice", d: doc1Data });
    await rawFireproof.put({ _id: "users_bob", d: doc2Data });
    await rawFireproof.put({ _id: "users_charlie", d: doc3Data });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create store with password1
    const store = new EncryptedStore(rawFireproof, "password1", listener);
    await store.loadAll();

    // Should have successfully loaded 2 documents
    const docsAddedCalls = listener.calls.filter((c) => c.type === "docsAdded");
    expect(docsAddedCalls.length).toBeGreaterThan(0);

    const allDocs = docsAddedCalls.flatMap((c: any) =>
      c.events.flatMap((e: any) => e.docs),
    );
    expect(allDocs.length).toBe(2);
    const names = allDocs.map((d: any) => d.name).sort();
    expect(names).toEqual(["Alice", "Bob"]);

    // Should have fired decryptionError for the document encrypted with wrong password
    const errorCalls = listener.calls.filter(
      (c) => c.type === "decryptionError",
    );
    expect(errorCalls.length).toBe(1);
    expect(errorCalls[0].events.length).toBe(1);
    expect(errorCalls[0].events[0].docId).toBe("users_charlie");
    expect(errorCalls[0].events[0].error).toBeInstanceOf(Error);
    expect(errorCalls[0].events[0].doc).toBeDefined();
    expect(errorCalls[0].events[0].doc._id).toBe("users_charlie");
    expect(errorCalls[0].events[0].doc.d).toBeDefined(); // Has encrypted data
  });

  it("should fire decryptionError when corrupted data is stored in Fireproof", async () => {
    // Store documents with valid and corrupted data
    const encryptionHelper = new EncryptionHelper(
      "test-password",
      webcrypto as any,
    );

    const validData = await encryptionHelper.encrypt(
      JSON.stringify({ name: "Alice", age: 30 }),
    );

    await rawFireproof.put({ _id: "users_alice", d: validData });
    await rawFireproof.put({
      _id: "users_corrupted",
      d: "invalid-data-format",
    });
    await rawFireproof.put({
      _id: "users_corrupted2",
      d: "abcdef|123456", // Looks like valid format but isn't
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create store and load
    const store = new EncryptedStore(rawFireproof, "test-password", listener);
    await store.loadAll();

    // Should have successfully loaded 1 document
    const docsAddedCalls = listener.calls.filter((c) => c.type === "docsAdded");
    if (docsAddedCalls.length > 0) {
      const allDocs = docsAddedCalls.flatMap((c: any) =>
        c.events.flatMap((e: any) => e.docs),
      );
      expect(allDocs.length).toBe(1);
      expect(allDocs[0].name).toBe("Alice");
    }

    // Should have fired decryptionError for the 2 corrupted documents
    const errorCalls = listener.calls.filter(
      (c) => c.type === "decryptionError",
    );
    expect(errorCalls.length).toBe(1);
    expect(errorCalls[0].events.length).toBe(2);

    const errorDocIds = errorCalls[0].events.map((e: any) => e.docId).sort();
    expect(errorDocIds).toEqual(["users_corrupted", "users_corrupted2"]);

    // Verify documents are included
    errorCalls[0].events.forEach((e: any) => {
      expect(e.doc).toBeDefined();
      expect(e.doc._id).toBe(e.docId);
    });
  });

  it("should fire decryptionError when remote changes arrive with wrong encryption", async () => {
    const store = new EncryptedStore(rawFireproof, "password1", listener);
    await store.loadAll();

    // Create a valid document first
    await store.put("users", { _id: "alice", name: "Alice" });
    await new Promise((resolve) => setTimeout(resolve, 200));

    listener.calls = []; // Clear previous events

    // Simulate a remote change with wrong password (as if another client wrote it)
    const wrongEncryptionHelper = new EncryptionHelper(
      "password2",
      webcrypto as any,
    );
    const wrongData = await wrongEncryptionHelper.encrypt(
      JSON.stringify({ name: "Bob", role: "admin" }),
    );

    await rawFireproof.put({ _id: "users_bob", d: wrongData });

    // Wait for subscription to trigger
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Should have fired decryptionError
    const errorCalls = listener.calls.filter(
      (c) => c.type === "decryptionError",
    );
    expect(errorCalls.length).toBeGreaterThan(0);

    const allErrors = errorCalls.flatMap((c: any) => c.events);
    const bobError = allErrors.find((e: any) => e.docId === "users_bob");
    expect(bobError).toBeDefined();
    expect(bobError.error).toBeInstanceOf(Error);
    expect(bobError.doc).toBeDefined();
    expect(bobError.doc._id).toBe("users_bob");
  });

  it("should fire decryptionError when remote changes arrive with corrupted data", async () => {
    const store = new EncryptedStore(rawFireproof, "test-password", listener);
    await store.loadAll();

    listener.calls = []; // Clear load events

    // Simulate a remote change with corrupted data
    await rawFireproof.put({
      _id: "users_corrupted",
      d: "totally-broken-data",
    });

    // Wait for subscription to trigger
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Should have fired decryptionError
    const errorCalls = listener.calls.filter(
      (c) => c.type === "decryptionError",
    );
    expect(errorCalls.length).toBeGreaterThan(0);

    const allErrors = errorCalls.flatMap((c: any) => c.events);
    const corruptedError = allErrors.find(
      (e: any) => e.docId === "users_corrupted",
    );
    expect(corruptedError).toBeDefined();
    expect(corruptedError.error).toBeInstanceOf(Error);
    expect(corruptedError.doc).toBeDefined();
    expect(corruptedError.doc._id).toBe("users_corrupted");
  });

  it("should continue processing other documents even when some fail to decrypt", async () => {
    // Mix of valid and invalid documents
    const encryptionHelper = new EncryptionHelper(
      "test-password",
      webcrypto as any,
    );
    const wrongEncryptionHelper = new EncryptionHelper(
      "wrong-password",
      webcrypto as any,
    );

    const doc1 = await encryptionHelper.encrypt(
      JSON.stringify({ name: "Alice" }),
    );
    const doc2 = await wrongEncryptionHelper.encrypt(
      JSON.stringify({ name: "Bob" }),
    );
    const doc3 = await encryptionHelper.encrypt(
      JSON.stringify({ name: "Charlie" }),
    );
    const doc4 = "corrupted-data";

    await rawFireproof.put({ _id: "users_alice", d: doc1 });
    await rawFireproof.put({ _id: "users_bob", d: doc2 });
    await rawFireproof.put({ _id: "users_charlie", d: doc3 });
    await rawFireproof.put({ _id: "users_dave", d: doc4 });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const store = new EncryptedStore(rawFireproof, "test-password", listener);
    await store.loadAll();

    // Should have successfully loaded 2 documents
    const docsAddedCalls = listener.calls.filter((c) => c.type === "docsAdded");
    expect(docsAddedCalls.length).toBeGreaterThan(0);

    const allDocs = docsAddedCalls.flatMap((c: any) =>
      c.events.flatMap((e: any) => e.docs),
    );
    expect(allDocs.length).toBe(2);
    const names = allDocs.map((d: any) => d.name).sort();
    expect(names).toEqual(["Alice", "Charlie"]);

    // Should have fired decryptionError for the 2 failed documents
    const errorCalls = listener.calls.filter(
      (c) => c.type === "decryptionError",
    );
    expect(errorCalls.length).toBe(1);
    expect(errorCalls[0].events.length).toBe(2);

    const errorDocIds = errorCalls[0].events.map((e: any) => e.docId).sort();
    expect(errorDocIds).toEqual(["users_bob", "users_dave"]);

    // Verify all error events include the document
    errorCalls[0].events.forEach((e: any) => {
      expect(e.doc).toBeDefined();
      expect(e.doc._id).toBeTruthy();
    });
  });

  it("should not fire decryptionError callback if not provided", async () => {
    // Create listener without decryptionError callback
    const listenerWithoutError = {
      docsAdded: () => {},
      docsChanged: () => {},
      docsDeleted: () => {},
      // No decryptionError callback
    };

    // Store document with wrong password
    const wrongEncryptionHelper = new EncryptionHelper(
      "wrong-password",
      webcrypto as any,
    );
    const wrongData = await wrongEncryptionHelper.encrypt(
      JSON.stringify({ name: "Bob" }),
    );
    await rawFireproof.put({ _id: "users_bob", d: wrongData });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should not throw error when decryptionError callback is missing
    const store = new EncryptedStore(
      rawFireproof,
      "test-password",
      listenerWithoutError,
    );
    await expect(store.loadAll()).resolves.not.toThrow();
  });

  it("should include error details in DecryptionErrorEvent", async () => {
    const wrongEncryptionHelper = new EncryptionHelper(
      "wrong-password",
      webcrypto as any,
    );
    const wrongData = await wrongEncryptionHelper.encrypt(
      JSON.stringify({ name: "Bob" }),
    );
    await rawFireproof.put({ _id: "users_bob", d: wrongData });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const store = new EncryptedStore(rawFireproof, "test-password", listener);
    await store.loadAll();

    const errorCalls = listener.calls.filter(
      (c) => c.type === "decryptionError",
    );
    expect(errorCalls.length).toBe(1);

    const errorEvent: DecryptionErrorEvent = errorCalls[0].events[0];
    expect(errorEvent).toHaveProperty("docId");
    expect(errorEvent).toHaveProperty("error");
    expect(errorEvent).toHaveProperty("doc");
    expect(errorEvent.docId).toBe("users_bob");
    expect(errorEvent.error).toBeInstanceOf(Error);
    expect(errorEvent.error.message).toBeTruthy();
    expect(errorEvent.doc).toBeDefined();
    expect(errorEvent.doc._id).toBe("users_bob");
    expect(errorEvent.doc.d).toBeDefined(); // Has encrypted data field
  });
});
