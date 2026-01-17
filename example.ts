/**
 * Example usage of EncryptedStore
 */

import PouchDB from "pouchdb";
import { EncryptedStore } from "./src/index.js";

async function main() {
  // Create a PouchDB database
  const db = new PouchDB("my-expenses");

  // Create encrypted store with listeners
  const store = new EncryptedStore(db, "my-secure-password", {
    onChange: (docs) => {
      console.log("\n📝 Documents changed:");
      docs.forEach((doc) => {
        console.log(`  ${doc._table}/${doc._id}:`, doc);
      });
    },

    onDelete: (docs) => {
      console.log("\n🗑️  Documents deleted:");
      docs.forEach((doc) => {
        console.log(`  ${doc._table}/${doc._id}`);
      });
    },

    onConflict: (conflicts) => {
      console.log("\n⚠️  Conflicts detected:");
      conflicts.forEach((conflict) => {
        console.log(`  ${conflict.table}/${conflict.id}`);
        console.log("    Winner:", conflict.winner);
        console.log("    Losers:", conflict.losers);

        // Auto-resolve by picking latest timestamp
        const latest = [conflict.winner, ...conflict.losers].sort(
          (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
        )[0];

        console.log("    Auto-resolving to:", latest);
        store.resolveConflict(conflict.table, conflict.id, latest);
      });
    },

    onSync: (info) => {
      console.log(
        `\n🔄 Sync (${info.direction}): ${info.change.docs_written || info.change.docs_read || 0} docs`,
      );
    },

    onError: (errors) => {
      console.error("\n❌ Decryption errors:");
      errors.forEach((err) => {
        console.error(`  ${err.docId}: ${err.error.message}`);
      });
    },
  });

  // Load existing documents
  console.log("Loading existing documents...");
  await store.loadAll();

  // Create some expense documents
  console.log("\nAdding expenses...");
  await store.put("expenses", {
    _id: "lunch",
    amount: 15.5,
    description: "Lunch at cafe",
    date: "2024-01-15",
    timestamp: Date.now(),
  });

  await store.put("expenses", {
    _id: "coffee",
    amount: 4.5,
    description: "Morning coffee",
    date: "2024-01-15",
    timestamp: Date.now(),
  });

  // Create a task document
  await store.put("tasks", {
    _id: "task1",
    title: "Review expenses",
    status: "started",
    startTime: Date.now(),
    timestamp: Date.now(),
  });

  // Get a specific document
  const lunch = await store.get("expenses", "lunch");
  console.log("\n📄 Retrieved document:", lunch);

  // Get all expenses
  const allExpenses = await store.getAll("expenses");
  console.log("\n📊 All expenses:", allExpenses);

  // Get all documents
  const allDocs = await store.getAll();
  console.log(`\n📚 Total documents: ${allDocs.length}`);

  // Update a document
  console.log("\nUpdating task...");
  await store.put("tasks", {
    _id: "task1",
    title: "Review expenses",
    status: "completed",
    startTime: lunch?.timestamp,
    endTime: Date.now(),
    timestamp: Date.now(),
  });

  // Optional: Connect to remote CouchDB for sync
  // Uncomment if you have a CouchDB server running
  /*
  console.log("\n🌐 Connecting to remote CouchDB...");
  await store.connectRemote({
    url: 'http://admin:password@localhost:5984/my-expenses',
    live: true,
    retry: true
  });
  console.log("✅ Connected and syncing...");
  */

  // Wait a bit to see change events
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Delete a document
  console.log("\nDeleting coffee expense...");
  await store.delete("expenses", "coffee");

  // Final state
  const finalExpenses = await store.getAll("expenses");
  console.log(`\n✅ Final expense count: ${finalExpenses.length}`);

  // Cleanup
  console.log("\nExample complete!");
}

main().catch(console.error);
