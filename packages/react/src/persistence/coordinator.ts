import { parseGraphDocument, type GraphDocument } from "@threadrift/core";
import { createHttpPersistenceAdapter } from "./http-adapter";
import type { LoadedDocument, PersistenceAdapter, PersistenceOptions, StorageLike } from "./types";

export interface SaveState {
  isDirty: boolean;
  saveStatus: "idle" | "dirty" | "saving" | "saved" | "error";
  saveError: string | null;
  draftError: string | null;
  lastSaved?: number | null;
  documentRevision?: number;
}
export interface Draft { document: GraphDocument; baseRevision: string | null; writer: string }
interface Callbacks {
  snapshot(): GraphDocument;
  loaded(): boolean;
  autoSave(): boolean;
  report(patch: Partial<SaveState>): void;
}

/** One coordinator per store: detached snapshots, one writer, coalesced follow-up. */
export class PersistenceCoordinator {
  private adapter: PersistenceAdapter = createHttpPersistenceAdapter();
  private options: PersistenceOptions = {};
  private enabled = true;
  private version = 0;
  private cleanVersion = 0;
  private generation = 0;
  private remoteRevision: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<boolean> | undefined;
  private writeEpoch = 0;
  private requested = false;
  private writer = Math.random().toString(36).slice(2);
  private pendingKey = "threadrift:draft:/api/graph";
  constructor(private callbacks: Callbacks) {}

  configure(options: PersistenceOptions | false) {
    this.cancelTimer();
    this.generation++;
    this.requested = false;
    this.running = undefined;
    this.remoteRevision = null;
    this.enabled = options !== false;
    this.options = options || {};
    this.adapter = this.options.adapter ?? createHttpPersistenceAdapter(this.options.endpoint);
    this.pendingKey = this.options.storageKey ?? `threadrift:draft:${this.options.endpoint ?? "/api/graph"}`;
  }
  private storage(): StorageLike | null {
    if (this.options.storage !== undefined) return this.options.storage;
    try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
  }
  private cancelTimer() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  get revision() { return this.remoteRevision; }
  get currentVersion() { return this.version; }
  get dirty() { return this.version !== this.cleanVersion; }
  get saving() { return !!this.running; }
  get currentWriteEpoch() { return this.writeEpoch; }

  accept(revision: string | null | undefined, dirty = false) {
    this.cancelTimer();
    this.requested = false;
    if (revision !== undefined) this.remoteRevision = revision;
    this.version++;
    // An earlier write can still complete after a synchronous document replacement.
    // Keep the replacement dirty and queue it behind that write, never report it saved.
    dirty ||= !!this.running;
    this.cleanVersion = dirty ? this.version - 1 : this.version;
    this.callbacks.report({ documentRevision: this.version, isDirty: dirty, saveStatus: dirty ? "dirty" : "idle", saveError: null, lastSaved: null });
    if (dirty) { this.backup(); this.schedule(); }
  }
  changed() {
    this.version++;
    this.callbacks.report({ documentRevision: this.version, isDirty: true, saveStatus: this.running ? "saving" : "dirty", saveError: null });
    this.backup();
    this.schedule();
  }
  private schedule() {
    this.cancelTimer();
    if (!this.enabled || !this.callbacks.autoSave()) return;
    const delay = this.options.debounceMs ?? 250;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, Math.max(0, delay));
  }
  backup() {
    if (!this.enabled || !this.callbacks.loaded() || !this.dirty) return false;
    try {
      const storage = this.storage();
      if (!storage) return false;
      storage.setItem(this.pendingKey, JSON.stringify({ format: 1, document: this.callbacks.snapshot(), baseRevision: this.remoteRevision, writer: this.writer }));
      this.callbacks.report({ draftError: null });
      return true;
    } catch { this.callbacks.report({ draftError: "The browser could not keep a recovery draft. Save or export your changes before closing." }); return false; }
  }
  readDraft(): Draft | null {
    if (!this.enabled) return null;
    try {
      const raw = this.storage()?.getItem(this.pendingKey);
      if (!raw) return null;
      const draft = JSON.parse(raw);
      if (draft.format !== 1 || (draft.baseRevision !== null && typeof draft.baseRevision !== "string")) throw new Error("Invalid draft");
      return { document: parseGraphDocument(draft.document), baseRevision: draft.baseRevision, writer: draft.writer };
    } catch { this.callbacks.report({ draftError: "A recovery draft could not be read. It has been left in browser storage." }); return null; }
  }
  discardDraft(ownOnly = false) {
    try {
      if (ownOnly && this.readDraft()?.writer !== this.writer) return;
      this.storage()?.removeItem(this.pendingKey);
    } catch { this.callbacks.report({ draftError: "Could not remove the browser recovery draft." }); }
  }
  async load(signal?: AbortSignal): Promise<LoadedDocument> {
    if (!this.enabled) throw new Error("Persistence is disabled for this viewer.");
    return this.adapter.load(signal);
  }
  flush(): Promise<boolean> {
    this.cancelTimer();
    if (!this.enabled || !this.callbacks.loaded()) return Promise.resolve(false);
    this.requested = true;
    if (this.running) return this.running;
    const generation = this.generation;
    const adapter = this.adapter;
    const task = async () => {
      let success = true;
      while (this.requested && generation === this.generation) {
        this.cancelTimer();
        this.requested = false;
        const version = this.version;
        this.writeEpoch++;
        this.callbacks.report({ saveStatus: "saving", saveError: null });
        try {
          const snapshot = this.callbacks.snapshot();
          this.backup();
          const result = await adapter.save(snapshot, this.remoteRevision);
          if (generation !== this.generation) return false;
          this.remoteRevision = result.revision;
          this.cleanVersion = version;
          if (this.version === version) {
            this.discardDraft(true);
            this.callbacks.report({ isDirty: false, saveStatus: "saved", saveError: null, lastSaved: Date.now() });
          } else {
            this.backup();
            this.callbacks.report({ isDirty: true, saveStatus: "dirty" });
            if (this.callbacks.autoSave()) this.requested = true;
          }
        } catch (error) {
          if (generation !== this.generation) return false;
          success = false;
          this.requested = false;
          this.cancelTimer();
          this.callbacks.report({ isDirty: this.dirty, saveStatus: "error", saveError: error instanceof Error ? error.message : "Save failed" });
          break;
        }
      }
      return success && !this.dirty;
    };
    this.running = task().finally(() => { if (generation === this.generation) this.running = undefined; });
    return this.running;
  }
  detach() {
    this.cancelTimer(); this.backup();
    if (this.dirty && this.callbacks.autoSave()) void this.flush();
  }
}
