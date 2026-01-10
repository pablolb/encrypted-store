import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { webcrypto } from "node:crypto";
import { fireproof } from "use-fireproof";
import { EncryptedStore, TableEvent } from "../encryptedStore";
import { EncryptionHelper } from "../encryption";

interface Doc {
  _id: string;
  [key: string]: any;
}

interface StoreListener {
  docsAdded: (events: TableEvent[]) => void;
  docsChanged: (events: TableEvent[]) => void;
  docsDeleted: (events: TableEvent[]) => void;
}

describe("Fireproof Integration Tests", () => {
  let rawFireproof: any;
  let listener: StoreListener & { calls: any[] };

  beforeEach(() => {
    const testDbName = `test-db-${Date.now()}-${Math.random()}`;
    rawFireproof = fireproof(testDbName);

    // Track listener calls
    listener = {
      calls: [],
      docsAdded: (events: TableEvent[]) => {
        listener.calls.push({ type: "docsAdded", events });
      },
      docsChanged: (events: TableEvent[]) => {
        listener.calls.push({ type: "docsChanged", events });
      },
      docsDeleted: (events: TableEvent[]) => {
        listener.calls.push({ type: "docsDeleted", events });
      },
    };
  });

  afterEach(async () => {
    // Clean up - destroy the test database
    try {
      if (rawFireproof && rawFireproof.destroy) {
        await rawFireproof.destroy();
      }
    } catch (error) {
      console.warn("Error cleaning up test database:", error);
    }
  });

  it("should encrypt and store data in real Fireproof", async () => {
    const store = new EncryptedStore(rawFireproof, "test-password", listener);
    await store.loadAll();

    // Create a document
    await store.put("users", {
      _id: "alice",
      name: "Alice",
      email: "alice@example.com",
      balance: 100,
    });

    // Wait for Fireproof to process
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Read raw document from Fireproof
    const rawDoc = await rawFireproof.get("users_alice");

    // Verify it's encrypted
    expect(rawDoc).toBeDefined();
    expect(rawDoc).toHaveProperty("d");
    expect(rawDoc.d).toMatch(/^[a-f0-9]+\|[a-f0-9]+$/);

    // Verify we can't see plaintext data
    expect(rawDoc).not.toHaveProperty("name");
    expect(rawDoc).not.toHaveProperty("email");
    expect(rawDoc).not.toHaveProperty("balance");

    // Verify we can decrypt manually
    const encryptionHelper = new EncryptionHelper(
      "test-password",
      webcrypto as any,
    );
    const decrypted = JSON.parse(await encryptionHelper.decrypt(rawDoc.d));
    expect(decrypted.name).toBe("Alice");
    expect(decrypted.email).toBe("alice@example.com");
    expect(decrypted.balance).toBe(100);
  });

  it("should load all documents from Fireproof on initialization", async () => {
    // Pre-populate with encrypted documents
    const encryptionHelper = new EncryptionHelper(
      "test-password",
      webcrypto as any,
    );

    const doc1Data = await encryptionHelper.encrypt(
      JSON.stringify({ name: "Alice", age: 30 }),
    );
    const doc2Data = await encryptionHelper.encrypt(
      JSON.stringify({ name: "Bob", age: 25 }),
    );

    await rawFireproof.put({
      _id: "users_1",
      d: doc1Data,
    });
    await rawFireproof.put({
      _id: "users_2",
      d: doc2Data,
    });

    // Wait for Fireproof
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Now create store and load all
    const store = new EncryptedStore(rawFireproof, "test-password", listener);
    await store.loadAll();

    // Should have received docsAdded event with both documents
    const docsAddedCalls = listener.calls.filter((c) => c.type === "docsAdded");
    expect(docsAddedCalls.length).toBeGreaterThan(0);

    // Collect all docs from all docsAdded calls (events contain TableEvent[])
    const allNewDocs = docsAddedCalls.flatMap((c: any) =>
      c.events.flatMap((e: TableEvent) => e.docs),
    );
    expect(allNewDocs.length).toBeGreaterThanOrEqual(2);

    const names = allNewDocs.map((d: any) => d.name).sort();
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");
  });

  it("should detect changes via Fireproof subscribe", async () => {
    const store = new EncryptedStore(rawFireproof, "test-password", listener);
    await store.loadAll();

    listener.calls = []; // Clear initial load

    // Create a document
    await store.put("users", {
      _id: "charlie",
      name: "Charlie",
      status: "active",
    });

    // Wait for subscribe to trigger
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should have received docsAdded event
    const docsAddedCalls = listener.calls.filter((c) => c.type === "docsAdded");
    expect(docsAddedCalls.length).toBeGreaterThan(0);

    const allDocs = docsAddedCalls.flatMap((c: any) =>
      c.events.flatMap((e: TableEvent) => e.docs),
    );
    const charlieDoc = allDocs.find((d: any) => d.name === "Charlie");
    expect(charlieDoc).toBeDefined();
    expect(charlieDoc.status).toBe("active");
  });

  it("should handle external writes to Fireproof", async () => {
    const store = new EncryptedStore(rawFireproof, "test-password", listener);
    await store.loadAll();

    listener.calls = []; // Clear initial load

    // Write directly to Fireproof (simulating external change)
    const encryptionHelper = new EncryptionHelper(
      "test-password",
      webcrypto as any,
    );
    const encryptedData = await encryptionHelper.encrypt(
      JSON.stringify({ name: "Dave", role: "admin" }),
    );

    await rawFireproof.put({
      _id: "users_dave",
      d: encryptedData,
    });

    // Wait for subscribe to trigger our reload
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Should have detected the new document
    const docsAddedCalls = listener.calls.filter((c) => c.type === "docsAdded");
    expect(docsAddedCalls.length).toBeGreaterThan(0);

    const allDocs = docsAddedCalls.flatMap((c: any) =>
      c.events.flatMap((e: TableEvent) => e.docs),
    );
    const daveDoc = allDocs.find((d: any) => d.name === "Dave");
    expect(daveDoc).toBeDefined();
    expect(daveDoc.role).toBe("admin");
  });

  it("should handle multiple document types", async () => {
    const store = new EncryptedStore(rawFireproof, "test-password", listener);
    await store.loadAll();

    // Create documents of different types
    await store.put("users", { _id: "user1", name: "Alice" });
    await store.put("transactions", { _id: "txn1", amount: 100 });
    await store.put("settings", { _id: "config", theme: "dark" });

    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify all are encrypted with correct prefixes
    const userDoc = await rawFireproof.get("users_user1");
    const txnDoc = await rawFireproof.get("transactions_txn1");
    const settingsDoc = await rawFireproof.get("settings_config");

    expect(userDoc.d).toMatch(/^[a-f0-9]+\|[a-f0-9]+$/);
    expect(txnDoc.d).toMatch(/^[a-f0-9]+\|[a-f0-9]+$/);
    expect(settingsDoc.d).toMatch(/^[a-f0-9]+\|[a-f0-9]+$/);

    // Verify they're different encrypted data
    expect(userDoc.d).not.toBe(txnDoc.d);
    expect(txnDoc.d).not.toBe(settingsDoc.d);
  });

  it("should retrieve documents via get()", async () => {
    const store = new EncryptedStore(rawFireproof, "test-password", listener);
    await store.loadAll();

    // Create a document
    await store.put("users", {
      _id: "eve",
      name: "Eve",
      email: "eve@example.com",
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Retrieve it
    const retrieved = await store.get("users", "eve");

    expect(retrieved).toBeDefined();
    expect(retrieved?._id).toBe("eve");
    expect(retrieved?.name).toBe("Eve");
    expect(retrieved?.email).toBe("eve@example.com");
  });

  it("should return null for non-existent documents", async () => {
    const store = new EncryptedStore(rawFireproof, "test-password", listener);
    await store.loadAll();

    const retrieved = await store.get("users", "non-existent");
    expect(retrieved).toBeNull();
  });

  it("should handle wrong password gracefully", async () => {
    // Store a document with one password
    const encryptionHelper1 = new EncryptionHelper(
      "password1",
      webcrypto as any,
    );
    const encrypted = await encryptionHelper1.encrypt(
      JSON.stringify({ name: "Alice" }),
    );
    await rawFireproof.put({
      _id: "users_alice",
      d: encrypted,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Try to load with wrong password
    const store = new EncryptedStore(rawFireproof, "password2", listener);

    // Should fail to decrypt (documents will be skipped)
    await store.loadAll();

    // Should have no documents (failed to decrypt)
    const docsAddedCalls = listener.calls.filter((c) => c.type === "docsAdded");
    // Either no calls, or calls with empty events/docs
    if (docsAddedCalls.length > 0) {
      const allDocs = docsAddedCalls.flatMap((c: any) =>
        c.events.flatMap((e: TableEvent) => e.docs),
      );
      expect(allDocs).toHaveLength(0);
    }
  });

  it("should detect deletions when document is deleted in Fireproof", async () => {
    const store = new EncryptedStore(rawFireproof, "test-password", listener);
    await store.loadAll();

    // Create a document via the store
    await store.put("users", {
      _id: "temp-user",
      name: "Temporary User",
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    listener.calls = []; // Clear events from creation

    // Delete the document directly in Fireproof
    await rawFireproof.del("users_temp-user");

    // Wait for subscribe to trigger
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Should have received docsDeleted event
    const docsDeletedCalls = listener.calls.filter(
      (c) => c.type === "docsDeleted",
    );
    expect(docsDeletedCalls.length).toBeGreaterThan(0);

    const deletedIds = docsDeletedCalls.flatMap((c: any) =>
      c.events.flatMap((e: TableEvent) => e.docs.map((d: any) => d._id)),
    );
    expect(deletedIds).toContain("temp-user");
  });

  it("should delete documents via store.delete() method", async () => {
    const store = new EncryptedStore(rawFireproof, "test-password", listener);
    await store.loadAll();

    // Create a document
    await store.put("users", {
      _id: "frank",
      name: "Frank",
      email: "frank@example.com",
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    listener.calls = []; // Clear events from creation

    // Delete using the store's delete method
    await store.delete("users", "frank");

    // Wait for subscribe to trigger
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Should have received docsDeleted event with correct table
    const docsDeletedCalls = listener.calls.filter(
      (c) => c.type === "docsDeleted",
    );
    expect(docsDeletedCalls.length).toBeGreaterThan(0);

    // Find the users table event
    const usersDeletedEvent = docsDeletedCalls
      .flatMap((c: any) => c.events)
      .find((e: TableEvent) => e.table === "users");

    expect(usersDeletedEvent).toBeDefined();
    expect(usersDeletedEvent.docs).toHaveLength(1);
    expect(usersDeletedEvent.docs[0]._id).toBe("frank");

    // Verify the document is actually gone
    const retrieved = await store.get("users", "frank");
    expect(retrieved).toBeNull();
  });

  it("should detect updates and fire docsChanged (not docsAdded)", async () => {
    const store = new EncryptedStore(rawFireproof, "test-password", listener);
    await store.loadAll();

    // Create initial document
    await store.put("users", {
      _id: "george",
      name: "George",
      age: 30,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    listener.calls = []; // Clear creation events

    // Update the document
    const retrieved = await store.get("users", "george");
    expect(retrieved).toBeDefined();

    await store.put("users", {
      ...retrieved,
      age: 31, // Changed field
      city: "Boston", // New field
    });

    // Wait for subscribe to trigger
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Should fire docsChanged, NOT docsAdded
    const docsChangedCalls = listener.calls.filter(
      (c) => c.type === "docsChanged",
    );
    const docsAddedCalls = listener.calls.filter((c) => c.type === "docsAdded");

    expect(docsChangedCalls.length).toBeGreaterThan(0);
    expect(docsAddedCalls.length).toBe(0); // Should NOT be treated as new

    const allChanged = docsChangedCalls.flatMap((c: any) =>
      c.events.flatMap((e: TableEvent) => e.docs),
    );
    const georgeDoc = allChanged.find((d: any) => d._id === "george");

    expect(georgeDoc).toBeDefined();
    expect(georgeDoc.age).toBe(31);
    expect(georgeDoc.city).toBe("Boston");
  });
});
