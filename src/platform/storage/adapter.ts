export type WriteResult = { ok: true } | { ok: false; reason: 'quota' | 'denied' | 'unknown'; message: string };

/** Where saves live. Every write reports whether it landed; nothing fails silently. */
export interface StorageAdapter {
  readonly name: string;
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<WriteResult>;
  remove(key: string): Promise<void>;
}

export function classify(e: unknown): WriteResult {
  const name = (e as { name?: string })?.name ?? '';
  const message = (e as { message?: string })?.message ?? String(e);
  if (name === 'QuotaExceededError' || /quota/i.test(message)) return { ok: false, reason: 'quota', message };
  if (name === 'SecurityError' || name === 'InvalidStateError' || /denied|security|private/i.test(message)) return { ok: false, reason: 'denied', message };
  return { ok: false, reason: 'unknown', message };
}
