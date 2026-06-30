/**
 * Couche d'abstraction IndexedDB pour le cache des données volumineuses
 * (binders, signatures, etc.).
 *
 * IndexedDB n'a pas la limite de quota de 5 MB du localStorage, ce qui
 * résout l'erreur "Failed to execute 'setItem' on 'Storage' … exceeded the quota"
 * lorsqu'un binder contient des dataURL de signature (plusieurs centaines de KB).
 */

const DB_NAME = "usign-cache";
const DB_VERSION = 1;

/** Nom des stores (tables) dans IndexedDB. */
export const STORES = {
  BINDERS: "binders",
  INBOX_BINDERS: "inbox_binders",
  PARTICIPATED_BINDERS: "participated_binders",
  CC_BINDERS: "cc_binders",
  CONTACTS: "contacts",
} as const;

type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB n'est pas disponible dans cet environnement."));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Créer les stores s'ils n'existent pas déjà
      for (const storeName of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });

  return dbPromise;
}

/**
 * Lit une valeur depuis un store IndexedDB.
 * Retourne `fallback` si la clé n'existe pas ou en cas d'erreur.
 */
export async function dbGet<T>(storeName: StoreName, key: string, fallback: T): Promise<T> {
  try {
    const db = await openDB();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result !== undefined ? (result as T) : fallback);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch {
    return fallback;
  }
}

/**
 * Écrit une valeur dans un store IndexedDB.
 */
export async function dbSet<T>(storeName: StoreName, key: string, value: T): Promise<void> {
  try {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.put(value, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error(`IndexedDB write error (${storeName}:${key}):`, error);
  }
}

/**
 * Supprime une clé d'un store IndexedDB.
 */
export async function dbDelete(storeName: StoreName, key: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Ignorer silencieusement
  }
}
/**
 * Vide complètement un store IndexedDB.
 */
export async function dbClear(storeName: StoreName): Promise<void> {
  try {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Ignorer silencieusement
  }
}
