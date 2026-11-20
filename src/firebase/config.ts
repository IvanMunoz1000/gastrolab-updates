import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  persistentSingleTabManager,
  enableNetwork,
  doc,
  getDocFromServer,
  Firestore,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App
export const app = initializeApp(firebaseConfig);

// Initialize Firestore with forced HTTP long-polling (prevents 10s WebChannel streaming hangs
// in Cloud Run / iframe / mobile proxy environments) and IndexedDB Persistent Local Cache.
function createFirestoreInstance(): Firestore {
  try {
    return initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
        experimentalForceLongPolling: true,
        experimentalLongPollingOptions: { timeoutSeconds: 8 },
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch (multiTabErr) {
    console.warn('Multi-tab persistent cache fallback to single-tab:', multiTabErr);
    try {
      return initializeFirestore(
        app,
        {
          localCache: persistentLocalCache({
            tabManager: persistentSingleTabManager({ forceOwnership: true }),
          }),
          experimentalForceLongPolling: true,
          experimentalLongPollingOptions: { timeoutSeconds: 8 },
        },
        firebaseConfig.firestoreDatabaseId
      );
    } catch (err) {
      console.warn('Persistent cache fallback to memory cache:', err);
      try {
        return initializeFirestore(
          app,
          {
            experimentalForceLongPolling: true,
            experimentalLongPollingOptions: { timeoutSeconds: 8 },
          },
          firebaseConfig.firestoreDatabaseId
        );
      } catch {
        return getFirestore(app, firebaseConfig.firestoreDatabaseId);
      }
    }
  }
}

export const db = createFirestoreInstance();

// Automatically re-enable Firestore network transport when recovering from offline state
if (typeof window !== 'undefined') {
  let wasOffline = !navigator.onLine;
  const reconnectFirestore = () => {
    if (navigator.onLine) {
      if (wasOffline) {
        wasOffline = false;
        enableNetwork(db).catch(() => {});
      }
    }
  };
  window.addEventListener('offline', () => {
    wasOffline = true;
  });
  window.addEventListener('online', () => {
    wasOffline = true;
    reconnectFirestore();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wasOffline) {
      reconnectFirestore();
    }
  });
}

// Initialize Firebase Auth
export const auth = getAuth(app);

// Initialize Firebase Storage
export const storage = getStorage(app);

// Error logging conforming to AI Studio Firestore specs
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test initial connection as required by Firebase skill
export async function testConnection(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  try {
    await getDocFromServer(doc(db, 'system', 'connection_test'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline. Operating with local cache until connection resumes.');
    }
    return false;
  }
}
