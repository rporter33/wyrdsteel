import { classify, type StorageAdapter, type WriteResult } from './adapter';

export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'localStorage';
  async read(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  async write(key: string, value: string): Promise<WriteResult> {
    try {
      localStorage.setItem(key, value);
      return { ok: true };
    } catch (e) {
      return classify(e);
    }
  }
  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing to remove */
    }
  }
}
