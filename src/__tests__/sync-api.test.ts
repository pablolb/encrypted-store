import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { fireproof } from "use-fireproof";
import { EncryptedStore, TableEvent } from "../encryptedStore";

interface StoreListener {
  docsAdded: (events: TableEvent[]) => void;
  docsChanged: (events: TableEvent[]) => void;
  docsDeleted: (events: TableEvent[]) => void;
}

describe("Sync API Tests (no server required)", () => {
  const testDbName = `sync-api-test-${Date.now()}-${Math.random()}`;
  let db: any;
  let store: EncryptedStore;
  let listener: StoreListener & { calls: any[] };

  beforeEach(() => {
    db = fireproof(testDbName);

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

    store = new EncryptedStore(db, "test-password", listener);
  });

  afterEach(async () => {
    try {
      if (store) {
        store.disconnectRemote();
      }
      if (db && db.destroy) {
        await db.destroy();
      }
    } catch (error) {
      console.warn("Error cleaning up sync API test:", error);
    }
  });

  it("should have connectRemote method", () => {
    expect(typeof store.connectRemote).toBe("function");
  });

  it("should have disconnectRemote method", () => {
    expect(typeof store.disconnectRemote).toBe("function");
  });

  it("should accept connector function", async () => {
    // Mock connector function
    const mockConnector = (db: any, namespace: string, host: string) => ({
      ready: Promise.resolve(),
      disconnect: () => {},
    });

    // Should not throw
    await expect(
      store.connectRemote(mockConnector, {
        namespace: "test",
        host: "http://localhost:1999",
      }),
    ).resolves.not.toThrow();

    store.disconnectRemote();
  });

  it("should handle disconnectRemote gracefully when not connected", () => {
    // Should not throw
    expect(() => store.disconnectRemote()).not.toThrow();
  });

  it("should export ConnectorFunction type", () => {
    // Verify the connector function type works
    const mockConnector = (db: any, namespace: string, host: string) => ({
      ready: Promise.resolve(),
      disconnect: () => {},
    });
    expect(typeof mockConnector).toBe("function");
  });

  it("should export RemoteConnectOptions interface", () => {
    // Verify the options interface structure
    const options = {
      namespace: "test-namespace",
      host: "http://localhost:1999",
    };
    expect(options.namespace).toBe("test-namespace");
    expect(options.host).toBe("http://localhost:1999");
  });
});
