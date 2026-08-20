import { isTauri } from "./env";

let tauriFetchPromise: Promise<typeof globalThis.fetch> | null = null;

/**
 * Fetch compatível com o ambiente. No desktop (Tauri) usa o plugin HTTP
 * nativo (sem CORS); em Node/navegador usa o fetch global.
 */
export async function httpFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (isTauri()) {
    tauriFetchPromise ??= import("@tauri-apps/plugin-http").then(
      (mod) => mod.fetch as unknown as typeof globalThis.fetch,
    );
    const impl = await tauriFetchPromise;
    return impl(input as Request, init);
  }
  return globalThis.fetch(input, init);
}