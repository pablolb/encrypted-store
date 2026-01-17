/**
 * Browser example usage of EncryptedStore with Vite
 *
 * In your app:
 * npm install @mrbelloc/encrypted-store pouchdb-browser
 */

import PouchDB from "pouchdb-browser";
import { EncryptedStore } from "@mrbelloc/encrypted-store";

// Create a PouchDB database (uses IndexedDB in browser)
const db = new PouchDB("my-expenses");

// Create encrypted store with listeners
const store = new EncryptedStore(db, "my-secure-password", {
  onChange: (docs) => {
    console.log("📝 Documents changed:", docs);
    // Update your React/Vue/Svelte state here
    docs.forEach((doc) => {
      if (doc._table === "expenses") {
        updateExpenseInUI(doc);
      }
    });
  },

  onDelete: (docs) => {
    console.log("🗑️  Documents deleted:", docs);
    docs.forEach((doc) => {
      removeFromUI(doc._table, doc._id);
    });
  },

  onConflict: (conflicts) => {
    console.log("⚠️  Conflicts detected:", conflicts);

    // Show conflict indicator in UI
    conflicts.forEach((conflict) => {
      // You already have all versions decrypted!
      console.log("Winner:", conflict.winner);
      console.log("Losers:", conflict.losers);

      // Option 1: Auto-resolve by picking latest
      const allVersions = [conflict.winner, ...conflict.losers];
      const latest = allVersions.sort(
        (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
      )[0];

      store.resolveConflict(conflict.table, conflict.id, latest);

      // Option 2: Show modal for user to choose
      // showConflictModal(conflict);
    });
  },

  onSync: (info) => {
    console.log(`🔄 Sync (${info.direction}):`, info.change);
    // Update sync status indicator in UI
  },

  onError: (errors) => {
    console.error("❌ Decryption errors:", errors);
    // Handle wrong password or corrupted data
  },
});

// Initialize - load existing documents and start change detection
async function init() {
  await store.loadAll();
  console.log("✅ Store loaded and listening for changes");

  // Optional: Connect to CouchDB for sync
  // Uncomment if you have a CouchDB server
  /*
  await store.connectRemote({
    url: 'https://username:password@your-couchdb.com/mydb',
    live: true,
    retry: true
  });
  console.log("✅ Connected to remote CouchDB");
  */
}

// Example: Add an expense
async function addExpense() {
  await store.put("expenses", {
    _id: crypto.randomUUID(),
    amount: 15.5,
    description: "Lunch at café",
    date: new Date().toISOString(),
    timestamp: Date.now(),
  });
}

// Example: Get a specific expense
async function getExpense(id: string) {
  const expense = await store.get("expenses", id);
  console.log("Expense:", expense);

  // Check if it has conflicts
  const conflict = await store.getConflictInfo("expenses", id);
  if (conflict) {
    console.log("⚠️ This expense has conflicts!", conflict);
  }

  return expense;
}

// Example: Get all expenses
async function getAllExpenses() {
  const expenses = await store.getAll("expenses");
  console.log(`Found ${expenses.length} expenses`);
  return expenses;
}

// Example: Update an expense
async function updateExpense(id: string, updates: any) {
  const existing = await store.get("expenses", id);
  if (existing) {
    await store.put("expenses", {
      ...existing,
      ...updates,
      timestamp: Date.now(),
    });
  }
}

// Example: Delete an expense
async function deleteExpense(id: string) {
  await store.delete("expenses", id);
}

// Mock UI functions (replace with your actual UI framework)
function updateExpenseInUI(doc: any) {
  console.log("UI: Update expense", doc._id);
  // In React: setExpenses(prev => ({ ...prev, [doc._id]: doc }))
  // In Vue: expenses.value[doc._id] = doc
  // In Svelte: $expenses[doc._id] = doc
}

function removeFromUI(table: string, id: string) {
  console.log("UI: Remove", table, id);
  // In React: setExpenses(prev => { const next = {...prev}; delete next[id]; return next; })
}

// Start the app
init().catch(console.error);

// Export functions for use in your app
export { store, addExpense, getExpense, getAllExpenses, updateExpense, deleteExpense };
