/**
 * Example Usage of Encrypted Store
 *
 * This example shows how to use encrypted-store in a real application.
 * Run with: npx ts-node example.ts
 */

import { EncryptedStore, fireproof, type Doc } from './src/index';

// Define your data types
interface User extends Doc {
  name: string;
  email: string;
  role: string;
}

interface Transaction extends Doc {
  date: string;
  amount: number;
  description: string;
  category: string;
}

// In-memory state (your app's data model)
class AppState {
  users = new Map<string, User>();
  transactions: Transaction[] = [];

  addUser(user: User) {
    this.users.set(user._id, user);
    console.log(`Added user: ${user.name}`);
  }

  updateUser(user: User) {
    this.users.set(user._id, user);
    console.log(`Updated user: ${user.name}`);
  }

  removeUser(id: string) {
    const user = this.users.get(id);
    this.users.delete(id);
    console.log(`Removed user: ${user?.name || id}`);
  }

  addTransaction(txn: Transaction) {
    this.transactions.push(txn);
    console.log(`Added transaction: ${txn.description} - $${txn.amount}`);
  }

  updateTransaction(txn: Transaction) {
    const index = this.transactions.findIndex(t => t._id === txn._id);
    if (index >= 0) {
      this.transactions[index] = txn;
      console.log(`Updated transaction: ${txn.description}`);
    }
  }

  removeTransaction(id: string) {
    const index = this.transactions.findIndex(t => t._id === id);
    if (index >= 0) {
      const txn = this.transactions.splice(index, 1)[0];
      console.log(`Removed transaction: ${txn.description}`);
    }
  }

  summary() {
    console.log('\n📊 App State Summary:');
    console.log(`Users: ${this.users.size}`);
    console.log(`Transactions: ${this.transactions.length}`);
    if (this.transactions.length > 0) {
      const total = this.transactions.reduce((sum, t) => sum + t.amount, 0);
      console.log(`Total amount: $${total.toFixed(2)}`);
    }
  }
}

async function main() {
  console.log('🚀 Encrypted Store Example\n');

  // 1. Create app state
  const state = new AppState();

  // 2. Create Fireproof database
  const db = fireproof('example-app');

  // 3. Create encrypted store with event listeners
  const store = new EncryptedStore(db, 'example-password-123', {
    newDocs: (docs) => {
      console.log(`\n📥 Received ${docs.length} new document(s)`);
      docs.forEach(doc => {
        // Route to appropriate handler based on document structure
        if ('name' in doc && 'email' in doc) {
          state.addUser(doc as User);
        } else if ('amount' in doc && 'description' in doc) {
          state.addTransaction(doc as Transaction);
        }
      });
    },

    changedDocs: (docs) => {
      console.log(`\n🔄 Received ${docs.length} changed document(s)`);
      docs.forEach(doc => {
        if ('name' in doc && 'email' in doc) {
          state.updateUser(doc as User);
        } else if ('amount' in doc && 'description' in doc) {
          state.updateTransaction(doc as Transaction);
        }
      });
    },

    deletedDocs: (docs) => {
      console.log(`\n🗑️  Received ${docs.length} deleted document(s)`);
      docs.forEach(doc => {
        // Try to remove from both collections
        state.removeUser(doc._id);
        state.removeTransaction(doc._id);
      });
    }
  });

  // 4. Load all existing data
  console.log('📂 Loading all existing data...');
  await store.loadAll();
  state.summary();

  // 5. Create some users
  console.log('\n➕ Creating users...');
  await store.put('users', {
    _id: 'alice',
    name: 'Alice',
    email: 'alice@example.com',
    role: 'admin'
  } as User);

  await new Promise(resolve => setTimeout(resolve, 100)); // Wait for events

  await store.put('users', {
    _id: 'bob',
    name: 'Bob',
    email: 'bob@example.com',
    role: 'user'
  } as User);

  await new Promise(resolve => setTimeout(resolve, 100));

  // 6. Create some transactions
  console.log('\n💰 Creating transactions...');
  await store.put('transactions', {
    _id: 'txn1',
    date: '2024-01-10',
    amount: 125.50,
    description: 'Groceries',
    category: 'Food'
  } as Transaction);

  await new Promise(resolve => setTimeout(resolve, 100));

  await store.put('transactions', {
    _id: 'txn2',
    date: '2024-01-11',
    amount: 45.00,
    description: 'Gas',
    category: 'Transportation'
  } as Transaction);

  await new Promise(resolve => setTimeout(resolve, 100));

  // 7. Retrieve and display data
  console.log('\n🔍 Retrieving data...');
  const alice = await store.get('users', 'alice');
  console.log('Retrieved user:', alice);

  const txn1 = await store.get('transactions', 'txn1');
  console.log('Retrieved transaction:', txn1);

  // 8. Update a user
  console.log('\n✏️  Updating user...');
  const aliceUpdated = await store.get('users', 'alice');
  if (aliceUpdated) {
    aliceUpdated.role = 'superadmin';
    await store.put('users', aliceUpdated);
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // 9. Verify raw storage is encrypted
  console.log('\n🔒 Checking encryption...');
  const rawDoc = await db.get('users_alice');
  console.log('Raw document from Fireproof:');
  console.log('  _id:', rawDoc._id);
  console.log('  Has encrypted "d" field:', 'd' in rawDoc);
  console.log('  Plaintext "name" visible:', 'name' in rawDoc ? '❌ YES (BAD!)' : '✅ NO (GOOD!)');
  console.log('  Plaintext "email" visible:', 'email' in rawDoc ? '❌ YES (BAD!)' : '✅ NO (GOOD!)');
  console.log('  Encrypted data sample:', rawDoc.d?.substring(0, 50) + '...');

  // 10. Optional: Connect to remote sync
  console.log('\n🌐 Remote sync (optional):');
  console.log('  To enable sync across devices:');
  console.log('  1. Install connector: npm install @fireproof/partykit');
  console.log('  2. Import: import { connect } from "@fireproof/partykit"');
  console.log('  3. Call: await store.connectRemote(connect, {');
  console.log('       namespace: \'alice-abc123\',');
  console.log('       host: \'http://localhost:1999\'');
  console.log('     })');
  console.log('  See README for full sync documentation');

  // 11. Final summary
  state.summary();

  console.log('\n✅ Example completed successfully!');
  console.log('\n💡 Key takeaways:');
  console.log('  • All data is encrypted before storage');
  console.log('  • Events fire automatically on changes');
  console.log('  • Your app maintains its own in-memory state');
  console.log('  • Retrieval automatically decrypts data');
  console.log('  • Remote storage only sees encrypted blobs');
  console.log('  • Sync is optional - add it when you need multi-device support');
}

// Run the example
main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
