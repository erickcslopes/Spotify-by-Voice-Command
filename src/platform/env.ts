export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isNode(): boolean {
  return typeof process !== "undefined" && typeof process.versions?.node === "string";
}