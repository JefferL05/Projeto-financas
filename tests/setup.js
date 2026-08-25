import "fake-indexeddb/auto";

if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto = {
    ...(globalThis.crypto || {}),
    randomUUID: () => `test-${Date.now()}-${Math.random().toString(16).slice(2)}`
  };
}
