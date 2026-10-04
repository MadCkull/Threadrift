import type { GraphDocument } from "@threadrift/core";

export interface LoadedDocument { document: unknown; revision: string | null }
export interface PersistenceAdapter {
  load(signal?: AbortSignal): Promise<LoadedDocument>;
  save(document: GraphDocument, revision: string | null, signal?: AbortSignal): Promise<{ revision: string | null }>;
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface PersistenceOptions {
  adapter?: PersistenceAdapter;
  endpoint?: string;
  storageKey?: string;
  storage?: StorageLike | null;
  debounceMs?: number;
}

export class PersistenceError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); this.name = "PersistenceError"; }
}
