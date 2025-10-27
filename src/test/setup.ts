const createMemoryStorage = () => {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  } satisfies Storage;
};

const globalObject = globalThis as typeof globalThis & { window?: any };

if (typeof globalObject.window === "undefined") {
  globalObject.window = globalObject;
}

if (typeof globalObject.localStorage === "undefined") {
  Object.defineProperty(globalObject, "localStorage", {
    configurable: true,
    value: createMemoryStorage(),
  });
}
