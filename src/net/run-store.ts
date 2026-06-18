// run-store.ts — offline queue of recorded run tapes, in IndexedDB.
//
// A finished run's tape + claimed result is stored here on death, online OR
// offline. On (re)connect, run-sync drains the queue to the backend. We use
// IndexedDB (not localStorage) because it handles the larger blobs and writes
// asynchronously off the main thread — so persisting a tape never janks a
// frame. See docs/ALPHA-AND-BACKEND.md.

const DB_NAME = 'delve-runs';
const STORE = 'pending';
const DB_VERSION = 1;

export interface PendingRun {
  /** IndexedDB auto-key (absent until stored). */
  id?: number;
  seed: number;
  buildVersion: string;
  depth: number;
  kills: number;
  name: string;
  /** gzip + base64 of the serialized input tape (seed + per-step intents). */
  tape: string;
  at: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Queue a finished run for upload. */
export async function enqueueRun(rec: PendingRun): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** All queued runs (oldest first). */
export async function listPendingRuns(): Promise<PendingRun[]> {
  const db = await openDb();
  try {
    return await new Promise<PendingRun[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as PendingRun[]);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Remove a run after it's been uploaded. */
export async function deletePendingRun(id: number): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
