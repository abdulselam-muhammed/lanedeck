// localStorage under the "selamDeck.*" keys. Every access is guarded (private mode, blocked storage).
export function lsRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function lsWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}
