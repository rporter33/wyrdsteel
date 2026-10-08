import type { StorageAdapter, WriteResult } from './adapter';

/** In-memory storage for tests; can be told to refuse writes like a full or private browser. */
export class MemoryAdapter implements StorageAdapter {
  readonly name = 'memory';
  data: Record<string, string> = {};
  refuse: WriteResult | null = null;
  async read(key: string): Promise<string | null> {
    return this.data[key] ?? null;
  }
  async write(key: string, value: string): Promise<WriteResult> {
    if (this.refuse) return this.refuse;
    this.data[key] = value;
    return { ok: true };
  }
  async remove(key: string): Promise<void> {
    delete this.data[key];
  }
}
