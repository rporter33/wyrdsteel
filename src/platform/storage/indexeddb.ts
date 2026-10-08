import { classify, type StorageAdapter, type WriteResult } from './adapter';

const DB = 'wyrdsteel';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

/** Primary storage: larger quota than localStorage and does not block the main thread. */
export class IndexedDbAdapter implements StorageAdapter {
  readonly name = 'IndexedDB';
  private db: Promise<IDBDatabase> | null = null;
  private conn(): Promise<IDBDatabase> {
    return (this.db ??= open());
  }
  async read(key: string): Promise<string | null> {
    const db = await this.conn();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }
  async write(key: string, value: string): Promise<WriteResult> {
    try {
      const db = await this.conn();
      return await new Promise<WriteResult>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve({ ok: true });
        tx.onerror = () => resolve(classify(tx.error));
        tx.onabort = () => resolve(classify(tx.error ?? new Error('aborted')));
      });
    } catch (e) {
      return classify(e);
    }
  }
  async remove(key: string): Promise<void> {
    const db = await this.conn();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
}

/** IndexedDB when it opens, else localStorage (some private modes refuse IndexedDB). */
export async function pickStorage(): Promise<StorageAdapter> {
  if (typeof indexedDB !== 'undefined') {
    try {
      const a = new IndexedDbAdapter();
      await a.read('probe');
      return a;
    } catch {
      /* fall through */
    }
  }
  const { LocalStorageAdapter } = await import('./localstorage');
  return new LocalStorageAdapter();
}
