import type { PersistenceAdapter } from "./types";
import { PersistenceError } from "./types";

async function check(response: Response) {
  if (response.ok) return;
  const body = await response.json().catch(() => null);
  throw new PersistenceError(body?.error ?? `Graph request failed (${response.status})`, response.status);
}

async function request(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 15000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.arrayBuffer();
    return new Response([204, 205, 304].includes(response.status) ? null : body,
      { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  catch (error) {
    if (controller.signal.aborted && !init.signal?.aborted) throw new PersistenceError("The graph request timed out. Your local edits are retained; retry or load the disk copy to check its state.");
    throw error;
  } finally { clearTimeout(timer); init.signal?.removeEventListener("abort", cancel); }
}

/** Transport only. Document validation and save ordering belong to the coordinator. */
export function createHttpPersistenceAdapter(endpoint = "/api/graph"): PersistenceAdapter {
  return {
    async load(signal) {
      const response = await request(endpoint, { cache: "no-store", signal });
      if (response.status === 404 && endpoint === "/api/graph") {
        const fallback = await request("/data/graph.json", { cache: "no-store", signal });
        await check(fallback);
        return { document: await fallback.json(), revision: null };
      }
      await check(response);
      return { document: await response.json(), revision: response.headers.get("ETag") };
    },
    async save(document, revision, signal) {
      const response = await request(endpoint, { method: "POST", signal,
        headers: { "Content-Type": "application/json", ...(revision ? { "If-Match": revision } : { "If-None-Match": "*" }) },
        body: JSON.stringify(document) });
      await check(response);
      const body = await response.json().catch(() => null);
      return { revision: response.headers.get("ETag") ?? body?.revision ?? null };
    },
  };
}
