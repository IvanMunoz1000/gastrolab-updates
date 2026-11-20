import {
  getDoc,
  getDocFromCache,
  getDocs,
  getDocsFromCache,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * In Firebase v13 Web SDK with IndexedDB persistentLocalCache, write Promises
 * (`setDoc`, `updateDoc`, `deleteDoc`, `writeBatch.commit`) enqueue locally right away,
 * but ONLY resolve once the backend server ACKs them. If the terminal is offline or
 * experiencing lie-fi, `await setDoc(...)` would hang the UI indefinitely.
 *
 * This helper ensures the local IndexedDB write is enqueued and returns promptly when offline
 * (or after a bounded timeout) so POS actions (orders, billing, cash shifts) remain instant.
 */
export async function commitOfflineSafe<T>(
  writePromise: Promise<T>,
  label = 'firestore_write'
): Promise<void> {
  const safePromise = writePromise.then(
    () => undefined,
    (err) => {
      console.warn(`[OfflineSafe:${label}] Error diferido de escritura:`, err);
    }
  );

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    // Allow IndexedDB mutation queue microtask/transaction to register, then return immediately
    await Promise.race([safePromise, sleep(140)]);
    return;
  }

  // Online or lie-fi protection: wait up to 4.5s for server ACK, otherwise let IndexedDB sync in background
  await Promise.race([safePromise, sleep(4500)]);
}

/**
 * Reads Firestore queries using local IndexedDB cache immediately when offline,
 * or falls back cleanly from server/cache when connectivity drops or stalls mid-request.
 */
export async function getDocsOfflineSafe<T = DocumentData>(
  q: Query<T>,
  timeoutMs = 2200
): Promise<QuerySnapshot<T>> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    try {
      return await getDocsFromCache(q);
    } catch {
      return await getDocs(q);
    }
  }

  try {
    return await Promise.race([
      getDocs(q),
      sleep(timeoutMs).then(() => getDocsFromCache(q)),
    ]);
  } catch (err) {
    console.warn('[OfflineSafe] Fallback a caché local de Firestore:', err);
    return await getDocsFromCache(q);
  }
}

/**
 * Reads a single Firestore document with instant local cache fallback when offline or slow.
 */
export async function getDocOfflineSafe<T = DocumentData>(
  ref: DocumentReference<T>,
  timeoutMs = 1800
): Promise<DocumentSnapshot<T> | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    try {
      return await getDocFromCache(ref);
    } catch {
      return await getDoc(ref).catch(() => null);
    }
  }

  try {
    return await Promise.race([
      getDoc(ref),
      sleep(timeoutMs).then(() => getDocFromCache(ref)),
    ]);
  } catch {
    return await getDocFromCache(ref).catch(() => null);
  }
}
