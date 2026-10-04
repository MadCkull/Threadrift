import React, { createContext, useContext, useRef, useEffect } from "react";
import { createStore, useStore } from "zustand";
import type { StoreApi } from "zustand";
import { type ThreadriftStore, createThreadriftStore } from "../store/threadrift-store";
import type { GraphJSON } from "@threadrift/core";
import type { PersistenceOptions } from "../persistence/types";

// 1. Create a context for the store
export const ThreadriftContext = createContext<StoreApi<ThreadriftStore> | null>(null);

// 2. Create the Provider
export interface ThreadriftProviderProps {
  children: React.ReactNode;
  initialData?: GraphJSON;
  /** Configure once per provider. Use a distinct storageKey for distinct documents. */
  persistence?: PersistenceOptions | false;
}

export const ThreadriftProvider: React.FC<ThreadriftProviderProps> = ({ children, initialData, persistence }) => {
  const storeRef = useRef<StoreApi<ThreadriftStore>>();
  
  if (!storeRef.current) {
    storeRef.current = createStore(createThreadriftStore);
    if (persistence !== undefined) storeRef.current.getState().configurePersistence(persistence);
    if (initialData) {
      storeRef.current.getState().loadGraph(initialData);
    }
  }
  useEffect(() => storeRef.current!.getState().attachPersistence(), []);

  return (
    <ThreadriftContext.Provider value={storeRef.current}>
      {children}
    </ThreadriftContext.Provider>
  );
};

// 3. Create the Hook
export function useThreadrift<T>(selector: (state: ThreadriftStore) => T): T {
  const store = useContext(ThreadriftContext);
  if (!store) {
    throw new Error("useThreadrift must be used within a Threadrift.Root");
  }
  return useStore(store, selector);
}

// 4. Imperative API Hook
export function useThreadriftApi() {
  const store = useContext(ThreadriftContext);
  if (!store) {
    throw new Error("useThreadriftApi must be used within a Threadrift.Root");
  }

  return {
    flyToNode: (nodeId: number) => {
      const state = store.getState();
      const nodeIndex = state.activePath.findIndex((n) => n.id === nodeId);
      if (nodeIndex !== -1) {
        state.setScrollTarget(nodeIndex);
      } else {
        console.warn(`[Threadrift] Node ${nodeId} is not on the active path.`);
      }
    },
    exportJSON: () => {
      return store.getState().toJSON();
    },
    importJSON: (data: GraphJSON) => {
      store.getState().importGraph(data);
    },
    recompute: () => {
      store.getState().recompute();
    },
    // Allows direct access to the Zustand store instance if absolutely necessary
    store: store,
  };
}
