import React, { createContext, useContext, useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  deleteUser,
  signOut,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  onSnapshot,
  getDocs,
  collection,
  getFirestore,
  initializeFirestore,
  waitForPendingWrites,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType, testConnection } from '../firebase/config';
import firebaseConfig from '../../firebase-applet-config.json';
import { UserProfile, UserRole, SystemLicenseState, LicenseRecord, DeviceSession } from '../types';
import { getCurrentDeviceSession } from '../utils/device';
import { hashSecret, verifySecret } from '../utils/cryptoAuth';

function sanitizeCachedProfile(u: UserProfile): UserProfile {
  const { pin: _pin, authHash: _hash, authSalt: _salt, ...safeProfile } = u;
  return safeProfile;
}

/**
 * Maps Firebase Auth errors to clear, Spanish user-facing messages (sin mencionar correo).
 */
export function mapAuthErrorToSpanish(error: any): string {
  if (!error) return 'Ocurrió un error inesperado.';
  const code = error.code || '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Usuario o contraseña incorrectos. Verifica tus datos e intenta de nuevo.';
    case 'auth/email-already-in-use':
      return 'Ya existe una cuenta registrada con este usuario. Usa "Iniciar Sesión".';
    case 'auth/invalid-email':
      return 'El nombre de usuario ingresado no es válido.';
    case 'auth/weak-password':
      return 'La contraseña debe tener al menos 4 caracteres.';
    case 'auth/network-request-failed':
      return 'Error de conexión: No se pudo conectar con el servidor de autenticación. Verifica tu conexión.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos fallidos. El acceso ha sido bloqueado temporalmente por seguridad. Intenta más tarde.';
    case 'auth/operation-not-allowed':
      return 'El método de autenticación no está habilitado en Firebase Console.';
    default:
      return error.message || 'Error al autenticar. Por favor verifica tus credenciales.';
  }
}

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  ownerProfile: UserProfile | null;
  systemLicense: SystemLicenseState | null;
  isLoading: boolean;
  hasExistingUsers: boolean;
  currentDevice: DeviceSession;
  isTrialExpired: boolean;
  isBlockedByLicense: boolean;
  remainingTrialMs: number;
  isExpiringSoon: boolean;
  daysRemaining: number;
  licenseValidUntil: string | null;
  loginWithEmail: (usernameOrEmail: string, pass: string) => Promise<void>;
  registerUser: (name: string, lastName: string | undefined, email: string, pass: string, role: UserRole, storeName?: string) => Promise<void>;
  createStaffUser: (name: string, lastName: string | undefined, email: string, pass: string, role: UserRole) => Promise<{ uid: string }>;
  updateCurrentUserPassword: (newPass: string) => Promise<void>;
  verifyOwnerPassword: (ownerPass: string) => Promise<boolean>;
  verifyOwnerAndResetUserPassword: (
    ownerUsername: string,
    ownerPassword: string,
    targetUid: string,
    newPassword: string
  ) => Promise<void>;
  lookupRecoveryAccountByEmail: (email: string) => Promise<UserProfile | null>;
  resetPasswordWithEmailCode: (email: string, newPassword: string) => Promise<UserProfile>;
  switchActiveUserWithPassword: (targetUser: UserProfile, pass: string) => Promise<UserProfile>;
  logout: () => Promise<void>;
  logoutAndSync: () => Promise<void>;
  activateLicenseCode: (code: string) => Promise<{ success: boolean; message?: string }>;
  activate12CharLicense: (code: string) => Promise<{ success: boolean; message?: string }>;
  renewLicense: (code: string) => Promise<{ success: boolean; message?: string }>;
  simulateTrialExpiry: () => Promise<void>;
  resetTrial: () => Promise<void>;
  refreshLicenseStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getOrInitLocalInstallTimestamp(): number {
  try {
    const existing = localStorage.getItem('gastrolab_trial_started_at');
    if (existing) {
      const parsed = new Date(existing).getTime();
      if (!isNaN(parsed)) return parsed;
    }
    const nowIso = new Date().toISOString();
    localStorage.setItem('gastrolab_trial_started_at', nowIso);
    return new Date(nowIso).getTime();
  } catch {
    return Date.now();
  }
}

async function resolveIdentifierToEmail(rawIdentifier: string): Promise<string> {
  const clean = rawIdentifier.trim().toLowerCase();
  if (!clean) return clean;

  const matchesProfile = (u: Partial<UserProfile>) => {
    const firstName = (u.name || '').trim().toLowerCase();
    const fullName = `${u.name || ''} ${u.lastName || ''}`.trim().toLowerCase();
    const emailFull = (u.email || '').trim().toLowerCase();
    const authEmailFull = (u.authEmail || '').trim().toLowerCase();
    const emailPrefix = emailFull.split('@')[0];
    return (
      emailFull === clean ||
      authEmailFull === clean ||
      firstName === clean ||
      fullName === clean ||
      emailPrefix === clean
    );
  };

  try {
    const cachedRaw = localStorage.getItem('gastrolab_cached_users');
    if (cachedRaw) {
      const cachedUsers = JSON.parse(cachedRaw) as UserProfile[];
      const matched = cachedUsers.find(matchesProfile);
      if (matched?.authEmail || matched?.email) {
        return (matched.authEmail || matched.email).toLowerCase();
      }
    }
  } catch {
    // Ignore localStorage parse error
  }

  try {
    const snap = await getDocs(collection(db, 'login_profiles'));
    for (const d of snap.docs) {
      const data = d.data() as Partial<UserProfile>;
      if (matchesProfile(data) && (data.authEmail || data.email)) {
        return (data.authEmail || data.email)!.toLowerCase();
      }
    }
  } catch {
    // Ignore offline error
  }

  if (clean.includes('@')) return clean;
  const sanitizedUser = clean.replace(/[^a-z0-9._-]/g, '');
  return `${sanitizedUser || clean}@gastrolab.pos`;
}

/**
 * Ensures strictly 1 Owner profile and deduplicates redundant profiles.
 */
export function deduplicateUserProfiles(list: UserProfile[], preferredOwnerUid?: string): {
  canonicalOwner: UserProfile | null;
  uniqueProfiles: UserProfile[];
  duplicateOwnerUids: string[];
  duplicateStaffUids: string[];
} {
  const byUid = new Map<string, UserProfile>();
  for (const u of list) {
    if (u?.uid && !byUid.has(u.uid)) {
      byUid.set(u.uid, u);
    }
  }
  const dedupedByUid = Array.from(byUid.values());

  const owners = dedupedByUid.filter((u) => u.role === 'Owner');
  let canonicalOwner: UserProfile | null = null;
  if (owners.length > 0) {
    if (preferredOwnerUid) {
      canonicalOwner = owners.find((o) => o.uid === preferredOwnerUid) || null;
    }
    if (!canonicalOwner) {
      canonicalOwner =
        owners.find((o) => (o.email || '').toLowerCase() === 'dj.ivanmunoz@gmail.com') ||
        owners.find((o) => (o.email || '').toLowerCase() === 'admin@gastrolab.pos') ||
        [...owners].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))[0];
    }
  }

  const duplicateOwnerUids = canonicalOwner
    ? owners.filter((o) => o.uid !== canonicalOwner!.uid).map((o) => o.uid)
    : [];

  const staff = dedupedByUid.filter((u) => u.role !== 'Owner');
  const seenStaffKey = new Map<string, UserProfile>();
  const duplicateStaffUids: string[] = [];

  for (const s of staff) {
    const normName = `${(s.name || '').trim().toLowerCase()} ${(s.lastName || '').trim().toLowerCase()}`.trim();
    const key = `${normName}__${s.role}`;
    if (!normName) continue;
    const existing = seenStaffKey.get(key);
    if (!existing) {
      seenStaffKey.set(key, s);
    } else {
      // Keep the one that has authorizedAreas or was updated more recently
      const existingScore = (existing.authorizedAreas?.length || 0) + (existing.updatedAt ? 100 : 0);
      const currentScore = (s.authorizedAreas?.length || 0) + (s.updatedAt ? 100 : 0);
      if (currentScore > existingScore) {
        duplicateStaffUids.push(existing.uid);
        seenStaffKey.set(key, s);
      } else {
        duplicateStaffUids.push(s.uid);
      }
    }
  }

  const uniqueStaff = Array.from(seenStaffKey.values());
  const uniqueProfiles = canonicalOwner ? [canonicalOwner, ...uniqueStaff] : uniqueStaff;

  return { canonicalOwner, uniqueProfiles, duplicateOwnerUids, duplicateStaffUids };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const registeringRef = useRef(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [ownerProfile, setOwnerProfile] = useState<UserProfile | null>(() => {
    try {
      const cachedRaw = localStorage.getItem('gastrolab_cached_users');
      if (cachedRaw) {
        const list = JSON.parse(cachedRaw) as UserProfile[];
        return deduplicateUserProfiles(list).canonicalOwner;
      }
    } catch {
      // Ignore
    }
    return null;
  });
  const [systemLicense, setSystemLicense] = useState<SystemLicenseState | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasExistingUsers, setHasExistingUsers] = useState<boolean>(true);
  const [currentDevice] = useState<DeviceSession>(() => getCurrentDeviceSession());
  const [nowTimestamp, setNowTimestamp] = useState<number>(Date.now());
  const [localTrialStartMs] = useState<number>(() => getOrInitLocalInstallTimestamp());
  const syncedUidRef = useRef<string | null>(null);

  // Update license timestamp every 60s instead of 1s so the whole app never re-renders every second
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTimestamp(Date.now());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Keep ownerProfile & login_profiles synced regardless of which staff member logs in
  useEffect(() => {
    let cancelled = false;
    let unsubProfiles: (() => void) | null = null;

    auth.authStateReady().then(() => {
      if (cancelled) return;
      unsubProfiles = onSnapshot(
        collection(db, 'login_profiles'),
        (snap) => {
          const list: UserProfile[] = [];
          snap.forEach((d) => list.push({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) }));
          if (list.length > 0) {
            setHasExistingUsers(true);
            const { canonicalOwner, uniqueProfiles } = deduplicateUserProfiles(
              list,
              auth.currentUser?.uid
            );
            if (canonicalOwner) setOwnerProfile(canonicalOwner);
            try {
              localStorage.setItem(
                'gastrolab_cached_users',
                JSON.stringify(uniqueProfiles.map(sanitizeCachedProfile))
              );
            } catch {
              // Ignore quota errors
            }
          } else if (!snap.metadata.fromCache) {
            setHasExistingUsers(false);
            setOwnerProfile(null);
            try {
              localStorage.removeItem('gastrolab_cached_users');
            } catch {
              // Ignore storage restrictions
            }
          }
        },
        () => {}
      );
    });

    return () => {
      cancelled = true;
      if (unsubProfiles) unsubProfiles();
    };
  }, []);

  // Check, deduplicate, and sync users to localStorage + login_profiles once per authenticated user
  useEffect(() => {
    async function syncUsersDirectory() {
      if (!currentUser) {
        syncedUidRef.current = null;
        try {
          const snap = await getDocs(collection(db, 'login_profiles'));
          if (!snap.empty) setHasExistingUsers(true);
        } catch {
          // Ignore when offline
        }
        return;
      }

      if (syncedUidRef.current === currentUser.uid) return;
      syncedUidRef.current = currentUser.uid;

      try {
        const [usersSnap, loginProfilesSnap] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'login_profiles')),
        ]);
        setHasExistingUsers(!usersSnap.empty);
        if (!usersSnap.empty) {
          const rawList: UserProfile[] = usersSnap.docs.map((d) => ({
            uid: d.id,
            ...(d.data() as Omit<UserProfile, 'uid'>),
          }));

          const existingLoginMap = new Map<string, Partial<UserProfile>>();
          loginProfilesSnap.forEach((d) => existingLoginMap.set(d.id, d.data() as Partial<UserProfile>));

          const { canonicalOwner, uniqueProfiles, duplicateOwnerUids, duplicateStaffUids } =
            deduplicateUserProfiles(rawList, currentUser.uid);

          if (canonicalOwner) {
            setOwnerProfile(canonicalOwner);
          }

          // Remove duplicate Owners and duplicate redundant staff entries from Firestore
          const idsToRemove = [...duplicateOwnerUids, ...duplicateStaffUids];
          for (const dupId of idsToRemove) {
            if (dupId !== currentUser.uid) {
              deleteDoc(doc(db, 'users', dupId)).catch(() => {});
              deleteDoc(doc(db, 'login_profiles', dupId)).catch(() => {});
            }
          }

          // Remove orphaned login_profiles that no longer exist in users
          const validUids = new Set(uniqueProfiles.map((u) => u.uid));
          loginProfilesSnap.forEach((lp) => {
            if (!validUids.has(lp.id)) {
              deleteDoc(doc(db, 'login_profiles', lp.id)).catch(() => {});
            }
          });

          // Migrate any legacy plaintext `pin` fields to salted SHA-256 `authHash` + delete plaintext field
          for (const u of uniqueProfiles) {
            if (u.pin) {
              const legacyPin = String(u.pin).trim();
              if (legacyPin && (!u.authHash || !u.authSalt)) {
                hashSecret(legacyPin)
                  .then(({ hash, salt }) =>
                    updateDoc(doc(db, 'users', u.uid), {
                      authHash: hash,
                      authSalt: salt,
                      pin: deleteField(),
                    })
                  )
                  .catch(() => {});
              } else {
                updateDoc(doc(db, 'users', u.uid), {
                  pin: deleteField(),
                }).catch(() => {});
              }
            }

            const existingLp = existingLoginMap.get(u.uid);
            const needsSync =
              !existingLp ||
              existingLp.name !== u.name ||
              (existingLp.lastName || '') !== (u.lastName || '') ||
              existingLp.role !== u.role ||
              existingLp.email !== u.email ||
              (existingLp.authEmail || '') !== (u.authEmail || '');
            if (needsSync) {
              setDoc(
                doc(db, 'login_profiles', u.uid),
                {
                  uid: u.uid,
                  name: u.name,
                  lastName: u.lastName || '',
                  role: u.role,
                  email: u.email,
                  ...(u.authEmail ? { authEmail: u.authEmail } : {}),
                  createdAt: u.createdAt || new Date().toISOString(),
                },
                { merge: true }
              ).catch(() => {});
            }
          }

          try {
            localStorage.setItem(
              'gastrolab_cached_users',
              JSON.stringify(uniqueProfiles.map(sanitizeCachedProfile))
            );
          } catch {
            // Ignore quota errors
          }
        }
      } catch {
        setHasExistingUsers(true);
      }
    }
    syncUsersDirectory();
  }, [currentUser]);

  // Automatic 15-day trial initialization from first install/open
  useEffect(() => {
    let cancelled = false;
    let unsubscribeSystem: (() => void) | null = null;

    async function initSystem() {
      try {
        await auth.authStateReady();
        if (cancelled) return;

        testConnection().catch(() => {});

        const systemDocRef = doc(db, 'system', 'license');
        unsubscribeSystem = onSnapshot(
          systemDocRef,
          async (snap) => {
            if (snap.exists()) {
              setSystemLicense(snap.data() as SystemLicenseState);
            } else {
              const started = new Date(localTrialStartMs);
              const ends = new Date(localTrialStartMs + 15 * 24 * 60 * 60 * 1000);
              const initialLicense: SystemLicenseState = {
                id: 'license',
                trialStartedAt: started.toISOString(),
                trialEndsAt: ends.toISOString(),
                trialDurationDays: 15,
                status: 'trial',
                connectedDevices: [currentDevice],
                updatedAt: new Date().toISOString(),
              };
              try {
                await setDoc(systemDocRef, initialLicense);
                setSystemLicense(initialLicense);
              } catch (e) {
                console.warn('Could not write initial license doc:', e);
              }
            }
          },
          (err) => {
            console.warn('System license listener notice:', err);
          }
        );
      } catch (err) {
        console.error('System initialization error:', err);
      }
    }

    initSystem();

    return () => {
      cancelled = true;
      if (unsubscribeSystem) unsubscribeSystem();
    };
  }, [currentDevice, localTrialStartMs]);

  // Auth State Listener (with 4s failsafe timeout so offline/IndexedDB locks never freeze loading)
  useEffect(() => {
    let resolved = false;
    const failsafeTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        setIsLoading(false);
      }
    }, 4000);

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user && registeringRef.current) return;
      setCurrentUser(user);
      if (user) {
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const snap = await getDoc(userDocRef);
          if (snap.exists()) {
            const prof = snap.data() as UserProfile;
            setUserProfile(prof);
            if (prof.role === 'Owner') {
              setOwnerProfile(prof);
            }
          } else {
            const fallbackProfile: UserProfile = {
              uid: user.uid,
              name: user.displayName || user.email?.split('@')[0] || 'Propietario',
              email: user.email || '',
              role: 'Owner',
              createdAt: new Date().toISOString(),
            };
            try {
              await setDoc(userDocRef, fallbackProfile);
              setUserProfile(fallbackProfile);
              setOwnerProfile(fallbackProfile);
            } catch {
              setUserProfile(fallbackProfile);
            }
          }
        } catch (error) {
          console.error('Error fetching user profile:', error);
        }
      } else {
        setUserProfile(null);
      }
      if (!resolved) {
        resolved = true;
        clearTimeout(failsafeTimer);
      }
      setIsLoading(false);
    });

    return () => {
      clearTimeout(failsafeTimer);
      unsubscribeAuth();
    };
  }, []);

  // Compute trial/license status and live countdown
  const { isTrialExpired, remainingTrialMs, isBlockedByLicense, isExpiringSoon, daysRemaining, licenseValidUntil } = useMemo(() => {
    if (!systemLicense) {
      const localEndMs = localTrialStartMs + 15 * 24 * 60 * 60 * 1000;
      const remaining = Math.max(0, localEndMs - nowTimestamp);
      const trialDaysLeft = Math.ceil(remaining / (24 * 60 * 60 * 1000));
      return {
        isTrialExpired: remaining <= 0,
        remainingTrialMs: remaining,
        isBlockedByLicense: remaining <= 0,
        isExpiringSoon: trialDaysLeft <= 3 && trialDaysLeft > 0,
        daysRemaining: Math.max(0, trialDaysLeft),
        licenseValidUntil: new Date(localEndMs).toISOString(),
      };
    }

    if (systemLicense.status === 'active' && systemLicense.activeLicenseCode) {
      const activatedAtMs = systemLicense.activatedAt ? new Date(systemLicense.activatedAt).getTime() : nowTimestamp;
      const validUntilMs = systemLicense.licenseValidUntil
        ? new Date(systemLicense.licenseValidUntil).getTime()
        : activatedAtMs + 365 * 24 * 60 * 60 * 1000;

      const remainingMs = validUntilMs - nowTimestamp;
      const daysLeft = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
      const expired = remainingMs <= 0;
      const warning10Days = daysLeft <= 10 && daysLeft > 0;

      return {
        isTrialExpired: false,
        remainingTrialMs: 0,
        isBlockedByLicense: expired,
        isExpiringSoon: warning10Days,
        daysRemaining: Math.max(0, daysLeft),
        licenseValidUntil: new Date(validUntilMs).toISOString(),
      };
    }

    const trialEndMs = new Date(systemLicense.trialEndsAt).getTime();
    const remaining = Math.max(0, trialEndMs - nowTimestamp);
    const expired = remaining <= 0 || systemLicense.status === 'expired';
    const trialDaysLeft = Math.ceil(remaining / (24 * 60 * 60 * 1000));

    return {
      isTrialExpired: expired,
      remainingTrialMs: remaining,
      isBlockedByLicense: expired,
      isExpiringSoon: trialDaysLeft <= 3 && trialDaysLeft > 0,
      daysRemaining: Math.max(0, trialDaysLeft),
      licenseValidUntil: systemLicense.trialEndsAt,
    };
  }, [systemLicense, nowTimestamp, localTrialStartMs]);

  // Login with Username + Password
  const loginWithEmail = async (usernameOrEmail: string, pass: string) => {
    const cleanEmail = await resolveIdentifierToEmail(usernameOrEmail);
    const cleanPass = pass.trim();

    try {
      await signInWithEmailAndPassword(auth, cleanEmail, cleanPass);
    } catch (err: any) {
      if (cleanPass.length < 6) {
        const padded = cleanPass.padEnd(6, '0');
        await signInWithEmailAndPassword(auth, cleanEmail, padded);
      } else {
        throw err;
      }
    }
  };

  // Register user account (enforces strictly 1 Owner in the system)
  const registerUser = async (
    name: string,
    lastName: string | undefined,
    email: string,
    pass: string,
    role: UserRole,
    storeName?: string
  ) => {
    if (role === 'Owner') {
      const existingOwners = await getDocs(collection(db, 'login_profiles')).catch(() => null);
      const hasOwner = existingOwners?.docs.some((d) => (d.data() as UserProfile).role === 'Owner');
      if (hasOwner) {
        throw new Error('Solo puede existir 1 Propietario registrado en el sistema.');
      }
    }

    const cleanPass = pass.trim();
    const authPass = cleanPass.length < 6 ? cleanPass.padEnd(6, '0') : cleanPass;
    registeringRef.current = true;
    let createdUser: User | undefined;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), authPass);
      createdUser = cred.user;
      const { hash, salt } = await hashSecret(cleanPass);

      const profile: UserProfile = {
        uid: cred.user.uid,
        name: name.trim(),
        lastName: lastName?.trim() || '',
        email: email.trim().toLowerCase(),
        role,
        authHash: hash,
        authSalt: salt,
        createdAt: new Date().toISOString(),
      };
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', cred.user.uid), profile);
      batch.set(doc(db, 'login_profiles', cred.user.uid), {
        uid: profile.uid,
        name: profile.name,
        lastName: profile.lastName || '',
        role: profile.role,
        email: profile.email,
        createdAt: profile.createdAt,
      });
      if (role === 'Owner' && storeName?.trim()) {
        batch.set(doc(db, 'settings', 'general'), { localName: storeName.trim() }, { merge: true });
      }
      await batch.commit();
      setCurrentUser(cred.user);
      setUserProfile(profile);
      if (role === 'Owner') setOwnerProfile(profile);
      setHasExistingUsers(true);
    } catch (error) {
      if (createdUser) {
        await deleteUser(createdUser).catch(() => {});
        await signOut(auth).catch(() => {});
      }
      throw error;
    } finally {
      registeringRef.current = false;
    }
  };

  // Create additional staff account without disconnecting active user (never allows creating a 2nd Owner)
  const createStaffUser = async (
    name: string,
    lastName: string | undefined,
    email: string,
    pass: string,
    role: UserRole
  ): Promise<{ uid: string }> => {
    if (role === 'Owner') {
      throw new Error('Solo puede existir 1 Propietario en todo el sistema.');
    }

    const secondaryAppName = 'SecondaryStaffApp_' + Date.now();
    const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
    const secondaryAuth = getAuth(secondaryApp);

    try {
      const cleanPass = pass.trim();
      const authPass = cleanPass.length < 6 ? cleanPass.padEnd(6, '0') : cleanPass;
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email.trim(), authPass);
      const newUid = cred.user.uid;
      const { hash, salt } = await hashSecret(cleanPass);

      const profile: UserProfile = {
        uid: newUid,
        name: name.trim(),
        lastName: lastName?.trim() || '',
        email: email.trim().toLowerCase(),
        role,
        authHash: hash,
        authSalt: salt,
        canDeleteWithPersonalPassword: false,
        createdAt: new Date().toISOString(),
      };

      await setDoc(doc(db, 'users', newUid), profile);
      await setDoc(doc(db, 'login_profiles', newUid), {
        uid: profile.uid,
        name: profile.name,
        lastName: profile.lastName || '',
        role: profile.role,
        email: profile.email,
        createdAt: profile.createdAt,
      });
      try {
        const cachedRaw = localStorage.getItem('gastrolab_cached_users');
        const list: UserProfile[] = cachedRaw ? JSON.parse(cachedRaw) : [];
        localStorage.setItem(
          'gastrolab_cached_users',
          JSON.stringify([...list.filter((u) => u.uid !== newUid), sanitizeCachedProfile(profile)])
        );
      } catch {
        // Ignore
      }
      await signOut(secondaryAuth);
      return { uid: newUid };
    } finally {
      deleteApp(secondaryApp).catch(() => {});
    }
  };

  // Update currently logged-in user's password in Firebase Auth & update salted hash (never plaintext)
  const updateCurrentUserPassword = async (newPass: string) => {
    if (!auth.currentUser || !userProfile?.uid) {
      throw new Error('No hay sesión activa para actualizar la contraseña.');
    }

    const cleanNew = newPass.trim();
    if (cleanNew.length < 4) {
      throw new Error('La nueva contraseña debe tener al menos 4 caracteres.');
    }

    const authPass = cleanNew.length < 6 ? cleanNew.padEnd(6, '0') : cleanNew;

    try {
      await updatePassword(auth.currentUser, authPass);
    } catch (err: any) {
      if (err?.code === 'auth/requires-recent-login') {
        throw new Error(
          'Por seguridad, cierra sesión e inicia nuevamente antes de cambiar tu contraseña.'
        );
      }
      throw err;
    }

    const { hash, salt } = await hashSecret(cleanNew);
    await updateDoc(doc(db, 'users', userProfile.uid), {
      authHash: hash,
      authSalt: salt,
      pin: deleteField(),
      updatedAt: new Date().toISOString(),
    });
    setUserProfile((prev) => {
      if (!prev) return prev;
      const { pin: _pin, ...rest } = prev;
      return { ...rest, authHash: hash, authSalt: salt };
    });
  };

  // Verify the single Owner's password via Firebase Auth (with hashed offline fallback when disconnected)
  const verifyOwnerPassword = useCallback(async (ownerPass: string): Promise<boolean> => {
    const cleanPass = ownerPass.trim();
    if (!cleanPass) return false;

    const verifyOfflineHash = async (prof?: UserProfile | null): Promise<boolean> => {
      if (!prof) return false;
      if (prof.authHash && prof.authSalt) {
        return verifySecret(cleanPass, prof.authHash, prof.authSalt);
      }
      if (prof.pin && cleanPass === prof.pin) {
        return true;
      }
      return false;
    };

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    // Case 1: Active session belongs to Owner -> reauthenticate directly
    if (userProfile?.role === 'Owner' && auth.currentUser?.email) {
      if (isOffline) {
        return verifyOfflineHash(userProfile);
      }
      try {
        const cred = EmailAuthProvider.credential(auth.currentUser.email, cleanPass);
        await reauthenticateWithCredential(auth.currentUser, cred);
        return true;
      } catch (err: any) {
        if (cleanPass.length < 6) {
          try {
            const paddedCred = EmailAuthProvider.credential(
              auth.currentUser.email,
              cleanPass.padEnd(6, '0')
            );
            await reauthenticateWithCredential(auth.currentUser, paddedCred);
            return true;
          } catch (paddedErr: any) {
            if (paddedErr?.code === 'auth/network-request-failed') {
              return verifyOfflineHash(userProfile);
            }
            return false;
          }
        }
        if (err?.code === 'auth/network-request-failed') {
          return verifyOfflineHash(userProfile);
        }
        return false;
      }
    }

    // Case 2: Active session belongs to staff -> verify against Owner via isolated secondary app
    let targetOwner: UserProfile | null = ownerProfile;
    if (!targetOwner?.email || (!targetOwner.authHash && !targetOwner.pin)) {
      try {
        const snap = await getDocs(collection(db, 'users'));
        const owners = snap.docs
          .map((d) => ({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) }))
          .filter((u) => u.role === 'Owner');
        const canonical = deduplicateUserProfiles(owners).canonicalOwner;
        if (canonical) {
          targetOwner = canonical;
        }
      } catch {
        // Ignore offline
      }
    }

    const ownerAuthEmail = targetOwner?.authEmail || targetOwner?.email;
    if (!ownerAuthEmail) return false;
    if (isOffline) {
      return verifyOfflineHash(targetOwner);
    }

    const verifyAppName = `OwnerCheckApp_${Date.now()}`;
    const verifyApp = initializeApp(firebaseConfig, verifyAppName);
    const verifyAuth = getAuth(verifyApp);
    try {
      try {
        await signInWithEmailAndPassword(verifyAuth, ownerAuthEmail, cleanPass);
        await signOut(verifyAuth);
        return true;
      } catch (err: any) {
        if (cleanPass.length < 6) {
          try {
            await signInWithEmailAndPassword(verifyAuth, ownerAuthEmail, cleanPass.padEnd(6, '0'));
            await signOut(verifyAuth);
            return true;
          } catch (paddedErr: any) {
            if (paddedErr?.code === 'auth/network-request-failed') {
              return verifyOfflineHash(targetOwner);
            }
            return false;
          }
        }
        if (err?.code === 'auth/network-request-failed') {
          return verifyOfflineHash(targetOwner);
        }
        return false;
      }
    } finally {
      deleteApp(verifyApp).catch(() => {});
    }
  }, [userProfile, ownerProfile]);

  // Owner-authorized password reset for any user from LoginScreen ("Olvidé mi contraseña")
  const verifyOwnerAndResetUserPassword = async (
    ownerUsername: string,
    ownerPassword: string,
    targetUid: string,
    newPassword: string
  ) => {
    const cleanOwnerUser = ownerUsername.trim();
    const cleanOwnerPass = ownerPassword.trim();
    const cleanNew = newPassword.trim();

    if (!cleanOwnerUser || !cleanOwnerPass) {
      throw new Error('Ingresa el usuario y contraseña del Propietario.');
    }
    if (!targetUid) {
      throw new Error('Selecciona el usuario al que deseas cambiarle la contraseña.');
    }
    if (cleanNew.length < 4) {
      throw new Error('La nueva contraseña debe tener al menos 4 caracteres.');
    }

    const ownerEmail = await resolveIdentifierToEmail(cleanOwnerUser);
    const ownerAppName = `OwnerVerifyApp_${Date.now()}`;
    const ownerApp = initializeApp(firebaseConfig, ownerAppName);
    const ownerAuth = getAuth(ownerApp);
    let ownerDb;
    try {
      ownerDb = initializeFirestore(
        ownerApp,
        {
          experimentalForceLongPolling: true,
          experimentalLongPollingOptions: { timeoutSeconds: 8 },
        },
        firebaseConfig.firestoreDatabaseId
      );
    } catch {
      ownerDb = getFirestore(ownerApp, firebaseConfig.firestoreDatabaseId);
    }

    try {
      let ownerCred;
      try {
        ownerCred = await signInWithEmailAndPassword(ownerAuth, ownerEmail, cleanOwnerPass);
      } catch (err: any) {
        if (cleanOwnerPass.length < 6) {
          ownerCred = await signInWithEmailAndPassword(ownerAuth, ownerEmail, cleanOwnerPass.padEnd(6, '0'));
        } else {
          throw err;
        }
      }

      const ownerDocSnap = await getDoc(doc(ownerDb, 'users', ownerCred.user.uid));
      const ownerData = ownerDocSnap.exists() ? (ownerDocSnap.data() as UserProfile) : null;
      if (!ownerData || ownerData.role !== 'Owner') {
        throw new Error('Acceso denegado: Solo el Propietario del local puede restablecer contraseñas.');
      }

      const targetSnap = await getDoc(doc(ownerDb, 'users', targetUid));
      if (!targetSnap.exists()) {
        throw new Error('No se encontró la cuenta del usuario seleccionado.');
      }

      const targetData = targetSnap.data() as UserProfile;
      const newAuthPass = cleanNew.length < 6 ? cleanNew.padEnd(6, '0') : cleanNew;
      const { hash: newHash, salt: newSalt } = await hashSecret(cleanNew);

      if (targetUid === ownerCred.user.uid) {
        await updatePassword(ownerCred.user, newAuthPass);
        await updateDoc(doc(ownerDb, 'users', targetUid), {
          authHash: newHash,
          authSalt: newSalt,
          pin: deleteField(),
          updatedAt: new Date().toISOString(),
        });
      } else if (targetData.email && targetData.pin) {
        // Legacy account migration: update existing Auth password and remove plaintext `pin`
        const targetAppName = `TargetResetApp_${Date.now()}`;
        const targetApp = initializeApp(firebaseConfig, targetAppName);
        const targetAuth = getAuth(targetApp);
        try {
          const oldPin = String(targetData.pin).trim();
          let targetCred;
          try {
            targetCred = await signInWithEmailAndPassword(targetAuth, targetData.email, oldPin);
          } catch (err: any) {
            if (oldPin.length < 6) {
              targetCred = await signInWithEmailAndPassword(targetAuth, targetData.email, oldPin.padEnd(6, '0'));
            } else {
              throw err;
            }
          }
          await updatePassword(targetCred.user, newAuthPass);
          await signOut(targetAuth);
        } finally {
          deleteApp(targetApp).catch(() => {});
        }
        await updateDoc(doc(ownerDb, 'users', targetUid), {
          authHash: newHash,
          authSalt: newSalt,
          pin: deleteField(),
          updatedAt: new Date().toISOString(),
        });
      } else {
        // Clean password-less Firestore profile: provision refreshed Firebase Auth credential with alias email
        const baseHandle = (targetData.name || 'staff')
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, '') || 'staff';
        const resetEmail = `${baseHandle}.${Date.now().toString().slice(-6)}@gastrolab.pos`;
        const targetAppName = `StaffResetApp_${Date.now()}`;
        const targetApp = initializeApp(firebaseConfig, targetAppName);
        const targetAuth = getAuth(targetApp);
        try {
          const newCred = await createUserWithEmailAndPassword(targetAuth, resetEmail, newAuthPass);
          const { pin: _oldPin, ...restProfile } = targetData;
          const refreshedProfile: UserProfile = {
            ...restProfile,
            uid: newCred.user.uid,
            email: resetEmail,
            authHash: newHash,
            authSalt: newSalt,
            updatedAt: new Date().toISOString(),
          };
          await setDoc(doc(ownerDb, 'users', newCred.user.uid), refreshedProfile);
          await setDoc(doc(ownerDb, 'login_profiles', newCred.user.uid), {
            uid: newCred.user.uid,
            name: refreshedProfile.name,
            lastName: refreshedProfile.lastName || '',
            role: refreshedProfile.role,
            email: resetEmail,
            createdAt: refreshedProfile.createdAt || new Date().toISOString(),
          });
          await deleteDoc(doc(ownerDb, 'users', targetUid)).catch(() => {});
          await deleteDoc(doc(ownerDb, 'login_profiles', targetUid)).catch(() => {});
          await signOut(targetAuth);

          try {
            const cachedRaw = localStorage.getItem('gastrolab_cached_users');
            if (cachedRaw) {
              const list = JSON.parse(cachedRaw) as UserProfile[];
              const updated = [
                ...list.filter((u) => u.uid !== targetUid && u.uid !== newCred.user.uid),
                sanitizeCachedProfile(refreshedProfile),
              ];
              localStorage.setItem('gastrolab_cached_users', JSON.stringify(updated));
            }
          } catch {
            // Ignore quota errors
          }
        } finally {
          deleteApp(targetApp).catch(() => {});
        }
      }

      await signOut(ownerAuth);
    } finally {
      deleteApp(ownerApp).catch(() => {});
    }
  };

  // Lookup registered account by email for 8-digit recovery flow
  const lookupRecoveryAccountByEmail = async (rawEmail: string): Promise<UserProfile | null> => {
    const cleanEmail = rawEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) return null;

    let matched: UserProfile | null = null;
    try {
      const snap = await getDocs(collection(db, 'login_profiles'));
      snap.forEach((d) => {
        const data = { uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) };
        if ((data.email || '').trim().toLowerCase() === cleanEmail) {
          matched = data;
        }
      });
    } catch {
      // Fallback to localStorage cache when offline
    }

    if (!matched) {
      try {
        const cachedRaw = localStorage.getItem('gastrolab_cached_users');
        if (cachedRaw) {
          const cachedUsers = JSON.parse(cachedRaw) as UserProfile[];
          matched =
            cachedUsers.find((u) => (u.email || '').trim().toLowerCase() === cleanEmail) || null;
        }
      } catch {
        // Ignore parse error
      }
    }

    if (matched) {
      // Trigger native Firebase reset email in background as bonus (non-blocking)
      sendPasswordResetEmail(auth, cleanEmail).catch(() => {});
    }
    return matched;
  };

  // Complete email recovery after 8-digit code verification: update credentials cleanly
  const resetPasswordWithEmailCode = async (
    rawEmail: string,
    newPassword: string
  ): Promise<UserProfile> => {
    const cleanEmail = rawEmail.trim().toLowerCase();
    const cleanNew = newPassword.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Ingresa un correo electrónico válido.');
    }
    if (cleanNew.length < 4) {
      throw new Error('La nueva contraseña debe tener al menos 4 caracteres.');
    }

    const targetProfile = await lookupRecoveryAccountByEmail(cleanEmail);
    if (!targetProfile) {
      throw new Error('No se encontró ninguna cuenta registrada con ese correo electrónico.');
    }

    const newAuthPass = cleanNew.length < 6 ? cleanNew.padEnd(6, '0') : cleanNew;
    const { hash: newHash, salt: newSalt } = await hashSecret(cleanNew);

    const baseHandle =
      (targetProfile.name || cleanEmail.split('@')[0] || 'usuario')
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '') || 'usuario';
    const recoverAuthEmail = `rec.${baseHandle}.${Date.now().toString().slice(-6)}@gastrolab.pos`;

    const recoverAppName = `EmailRecoverApp_${Date.now()}`;
    const recoverApp = initializeApp(firebaseConfig, recoverAppName);
    const recoverAuth = getAuth(recoverApp);
    let recoverDb;
    try {
      recoverDb = initializeFirestore(
        recoverApp,
        {
          experimentalForceLongPolling: true,
          experimentalLongPollingOptions: { timeoutSeconds: 8 },
        },
        firebaseConfig.firestoreDatabaseId
      );
    } catch {
      recoverDb = getFirestore(recoverApp, firebaseConfig.firestoreDatabaseId);
    }

    try {
      const cred = await createUserWithEmailAndPassword(
        recoverAuth,
        recoverAuthEmail,
        newAuthPass
      );
      const newUid = cred.user.uid;

      let fullOldData: Partial<UserProfile> = { ...targetProfile };
      try {
        const oldUserSnap = await getDoc(doc(recoverDb, 'users', targetProfile.uid));
        if (oldUserSnap.exists()) {
          fullOldData = { ...fullOldData, ...(oldUserSnap.data() as Partial<UserProfile>) };
        }
      } catch {
        // Use targetProfile metadata if old doc read fails
      }

      const { pin: _oldPin, ...restProfile } = fullOldData;
      const updatedProfile: UserProfile = {
        uid: newUid,
        name: restProfile.name || targetProfile.name,
        lastName: restProfile.lastName || targetProfile.lastName || '',
        email: cleanEmail,
        authEmail: recoverAuthEmail,
        role: restProfile.role || targetProfile.role || 'Owner',
        ...(restProfile.authorizedAreas ? { authorizedAreas: restProfile.authorizedAreas } : {}),
        ...(restProfile.authorizedBranches ? { authorizedBranches: restProfile.authorizedBranches } : {}),
        ...(restProfile.allowedModules ? { allowedModules: restProfile.allowedModules } : {}),
        ...(restProfile.canDeleteWithPersonalPassword !== undefined
          ? { canDeleteWithPersonalPassword: restProfile.canDeleteWithPersonalPassword }
          : {}),
        authHash: newHash,
        authSalt: newSalt,
        createdAt: restProfile.createdAt || targetProfile.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await setDoc(doc(recoverDb, 'users', newUid), updatedProfile);
      await setDoc(doc(recoverDb, 'login_profiles', newUid), {
        uid: newUid,
        name: updatedProfile.name,
        lastName: updatedProfile.lastName || '',
        role: updatedProfile.role,
        email: updatedProfile.email,
        authEmail: recoverAuthEmail,
        createdAt: updatedProfile.createdAt,
      });

      if (targetProfile.uid && targetProfile.uid !== newUid) {
        await deleteDoc(doc(recoverDb, 'users', targetProfile.uid)).catch(() => {});
        await deleteDoc(doc(recoverDb, 'login_profiles', targetProfile.uid)).catch(() => {});
      }

      try {
        const cachedRaw = localStorage.getItem('gastrolab_cached_users');
        const list: UserProfile[] = cachedRaw ? JSON.parse(cachedRaw) : [];
        const updatedCache = [
          ...list.filter((u) => u.uid !== targetProfile.uid && u.uid !== newUid),
          sanitizeCachedProfile(updatedProfile),
        ];
        localStorage.setItem('gastrolab_cached_users', JSON.stringify(updatedCache));
      } catch {
        // Ignore cache write errors
      }

      if (updatedProfile.role === 'Owner') {
        setOwnerProfile(sanitizeCachedProfile(updatedProfile));
      }

      await signOut(recoverAuth);
      return updatedProfile;
    } finally {
      deleteApp(recoverApp).catch(() => {});
    }
  };

  // Switch active user seamlessly in-place with password only (no reload, no redirect to Login)
  const switchActiveUserWithPassword = async (
    targetUser: UserProfile,
    pass: string
  ): Promise<UserProfile> => {
    const cleanPass = pass.trim();
    if (!cleanPass) {
      throw new Error('Ingresa la contraseña del usuario seleccionado.');
    }

    const verifyLocalHash = async (prof?: UserProfile | null): Promise<boolean> => {
      if (!prof) return false;
      if (prof.authHash && prof.authSalt) {
        return verifySecret(cleanPass, prof.authHash, prof.authSalt);
      }
      if (prof.pin && cleanPass === String(prof.pin)) {
        return true;
      }
      return false;
    };

    // Fetch full user profile document (includes permissions & hashes)
    let fullTargetProfile: UserProfile = targetUser;
    try {
      const targetDoc = await getDoc(doc(db, 'users', targetUser.uid));
      if (targetDoc.exists()) {
        fullTargetProfile = {
          uid: targetDoc.id,
          ...(targetDoc.data() as Omit<UserProfile, 'uid'>),
        };
      }
    } catch {
      // Fallback to targetUser if offline cache unavailable
    }

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (isOffline) {
      const okOffline = await verifyLocalHash(fullTargetProfile);
      if (!okOffline) {
        throw new Error('Contraseña incorrecta para este usuario.');
      }
      setUserProfile(fullTargetProfile);
      if (fullTargetProfile.role === 'Owner') setOwnerProfile(fullTargetProfile);
      return fullTargetProfile;
    }

    const targetEmail = (
      fullTargetProfile.authEmail ||
      fullTargetProfile.email ||
      (await resolveIdentifierToEmail(fullTargetProfile.name))
    )
      .trim()
      .toLowerCase();

    try {
      let cred;
      try {
        cred = await signInWithEmailAndPassword(auth, targetEmail, cleanPass);
      } catch (err: any) {
        if (cleanPass.length < 6 && err?.code !== 'auth/network-request-failed') {
          cred = await signInWithEmailAndPassword(auth, targetEmail, cleanPass.padEnd(6, '0'));
        } else {
          throw err;
        }
      }

      try {
        const freshDoc = await getDoc(doc(db, 'users', cred.user.uid));
        if (freshDoc.exists()) {
          fullTargetProfile = {
            uid: freshDoc.id,
            ...(freshDoc.data() as Omit<UserProfile, 'uid'>),
          };
        }
      } catch {
        // Keep fullTargetProfile
      }

      setUserProfile(fullTargetProfile);
      if (fullTargetProfile.role === 'Owner') setOwnerProfile(fullTargetProfile);
      return fullTargetProfile;
    } catch (err: any) {
      if (err?.code === 'auth/network-request-failed') {
        const okOffline = await verifyLocalHash(fullTargetProfile);
        if (okOffline) {
          setUserProfile(fullTargetProfile);
          if (fullTargetProfile.role === 'Owner') setOwnerProfile(fullTargetProfile);
          return fullTargetProfile;
        }
      }
      if (
        err?.code === 'auth/invalid-credential' ||
        err?.code === 'auth/wrong-password' ||
        err?.code === 'auth/user-not-found'
      ) {
        throw new Error('Contraseña incorrecta. Verifica e intenta nuevamente.');
      }
      throw new Error(mapAuthErrorToSpanish(err));
    }
  };

  // Logout (returns to user selection / login WITHOUT clearing local cached data)
  const logout = async () => {
    try {
      await signOut(auth);
      setUserProfile(null);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // Full Logout & Sync: flush pending Firebase writes, clear active session, and return to Login
  const logoutAndSync = async () => {
    try {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        await Promise.race([
          waitForPendingWrites(db).catch(() => {}),
          new Promise<void>((resolve) => setTimeout(resolve, 2500)),
        ]);
      }
      try {
        sessionStorage.clear();
      } catch {
        // Ignore sessionStorage restrictions
      }
      syncedUidRef.current = null;
      await signOut(auth);
      setUserProfile(null);
    } catch (err) {
      console.error('Logout & sync error:', err);
      await signOut(auth).catch(() => {});
      setUserProfile(null);
    }
  };

  // Activate 8-character license code
  const activateLicenseCode = async (codeRaw: string): Promise<{ success: boolean; message?: string }> => {
    const code = codeRaw.trim().toUpperCase();

    if (code.length !== 8) {
      return { success: false, message: 'El código de licencia debe tener exactamente 8 caracteres alfanuméricos.' };
    }

    try {
      const licenseRef = doc(db, 'licenses', code);
      const licenseSnap = await getDoc(licenseRef);

      if (!licenseSnap.exists()) {
        return {
          success: false,
          message: `El código "${code}" no existe en el sistema. Verifica el código de 8 caracteres.`,
        };
      }

      const licenseData = licenseSnap.data() as LicenseRecord;
      if (licenseData.isUsed) {
        return {
          success: false,
          message: `El código "${code}" ya ha sido utilizado y activado previamente.`,
        };
      }

      const existingDevices = licenseData.connectedDevices || [];
      const pcCount = existingDevices.filter((d) => d.deviceType === 'PC').length;
      const mobileCount = existingDevices.filter((d) => d.deviceType === 'Mobile').length;

      const thisDeviceType = currentDevice.deviceType;
      const alreadyRegistered = existingDevices.some((d) => d.deviceId === currentDevice.deviceId);

      if (!alreadyRegistered) {
        if (thisDeviceType === 'PC' && pcCount >= 1) {
          return {
            success: false,
            message: 'Límite de terminales alcanzado: Esta licencia permite máximo 1 PC.',
          };
        }
        if (thisDeviceType === 'Mobile' && mobileCount >= 3) {
          return {
            success: false,
            message: 'Límite de terminales alcanzado: Esta licencia permite máximo 3 dispositivos móviles.',
          };
        }
      }

      const updatedDevices: DeviceSession[] = alreadyRegistered
        ? existingDevices.map((d) => (d.deviceId === currentDevice.deviceId ? currentDevice : d))
        : [...existingDevices, currentDevice];

      const now = new Date().toISOString();

      const updatedLicenseRecord: Partial<LicenseRecord> = {
        isUsed: true,
        status: 'used',
        usedAt: now,
        usedBy: currentUser?.uid || 'anonimo',
        activatedByEmail: currentUser?.email || 'sin-correo',
        connectedDevices: updatedDevices,
      };

      await updateDoc(licenseRef, updatedLicenseRecord);

      const systemDocRef = doc(db, 'system', 'license');
      const updatedSystemLicense: Partial<SystemLicenseState> = {
        status: 'active',
        activeLicenseCode: code,
        activatedAt: now,
        activatedBy: currentUser?.uid || '',
        activatedByEmail: currentUser?.email || '',
        connectedDevices: updatedDevices,
        updatedAt: now,
      };

      await updateDoc(systemDocRef, updatedSystemLicense);

      return {
        success: true,
        message: `¡Licencia ${code} activada con éxito para hasta 4 dispositivos (1 PC + 3 Móviles)!`,
      };
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `licenses/${code}`);
      return { success: false, message: error?.message || 'Error al activar la licencia.' };
    }
  };

  const simulateTrialExpiry = async () => {
    try {
      const pastDate = new Date(Date.now() - 3600000).toISOString();
      const systemDocRef = doc(db, 'system', 'license');
      await updateDoc(systemDocRef, {
        trialEndsAt: pastDate,
        status: 'expired',
        activeLicenseCode: '',
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'system/license');
    }
  };

  const resetTrial = async () => {
    try {
      const now = new Date();
      const ends = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
      try {
        localStorage.setItem('gastrolab_trial_started_at', now.toISOString());
      } catch {
        // Ignore
      }
      const systemDocRef = doc(db, 'system', 'license');
      await updateDoc(systemDocRef, {
        trialStartedAt: now.toISOString(),
        trialEndsAt: ends.toISOString(),
        status: 'trial',
        activeLicenseCode: '',
        updatedAt: now.toISOString(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'system/license');
    }
  };

  const refreshLicenseStatus = async () => {
    try {
      const systemDocRef = doc(db, 'system', 'license');
      const snap = await getDoc(systemDocRef);
      if (snap.exists()) {
        setSystemLicense(snap.data() as SystemLicenseState);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const activate12CharLicense = async (codeRaw: string): Promise<{ success: boolean; message?: string }> => {
    const cleanCode = codeRaw.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (cleanCode.length !== 12) {
      return {
        success: false,
        message: 'El código de licencia debe tener exactamente 12 caracteres alfanuméricos (ej. GL26ABC12345).',
      };
    }

    try {
      const now = new Date();
      const currentValidUntilMs =
        systemLicense?.status === 'active' && systemLicense?.licenseValidUntil
          ? new Date(systemLicense.licenseValidUntil).getTime()
          : 0;
      const baseMs = currentValidUntilMs > now.getTime() ? currentValidUntilMs : now.getTime();
      const validUntil = new Date(baseMs + 365 * 24 * 60 * 60 * 1000);
      const systemDocRef = doc(db, 'system', 'license');

      const licensePayload: Partial<SystemLicenseState> = {
        status: 'active',
        activeLicenseCode: cleanCode,
        activatedAt: now.toISOString(),
        activatedBy: currentUser?.uid || 'Owner',
        activatedByEmail: currentUser?.email || '',
        licenseValidUntil: validUntil.toISOString(),
        ownerName: ownerProfile?.name
          ? `${ownerProfile.name} ${ownerProfile.lastName || ''}`.trim()
          : userProfile?.name
          ? `${userProfile.name} ${userProfile.lastName || ''}`.trim()
          : '',
        updatedAt: now.toISOString(),
      };

      await setDoc(systemDocRef, licensePayload, { merge: true });
      return {
        success: true,
        message: `¡Licencia renovada/activada por 1 año (365 días) manteniendo todos tus datos intactos! Válida hasta el ${validUntil.toLocaleDateString('es-EC')}.`,
      };
    } catch (err: any) {
      console.error('Error al activar licencia 12 chars:', err);
      return { success: false, message: err.message || 'Error al guardar la licencia en Firestore.' };
    }
  };

  const renewLicense = activate12CharLicense;

  const contextValue = useMemo<AuthContextType>(
    () => ({
      currentUser,
      userProfile,
      ownerProfile,
      systemLicense,
      isLoading,
      hasExistingUsers,
      currentDevice,
      isTrialExpired,
      isBlockedByLicense,
      remainingTrialMs,
      isExpiringSoon,
      daysRemaining,
      licenseValidUntil,
      loginWithEmail,
      registerUser,
      createStaffUser,
      updateCurrentUserPassword,
      verifyOwnerPassword,
      verifyOwnerAndResetUserPassword,
      lookupRecoveryAccountByEmail,
      resetPasswordWithEmailCode,
      switchActiveUserWithPassword,
      logout,
      logoutAndSync,
      activateLicenseCode,
      activate12CharLicense,
      renewLicense,
      simulateTrialExpiry,
      resetTrial,
      refreshLicenseStatus,
    }),
    [
      currentUser,
      userProfile,
      ownerProfile,
      systemLicense,
      isLoading,
      hasExistingUsers,
      currentDevice,
      isTrialExpired,
      isBlockedByLicense,
      remainingTrialMs,
      isExpiringSoon,
      daysRemaining,
      licenseValidUntil,
      verifyOwnerPassword,
    ]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe ser utilizado dentro de AuthProvider');
  }
  return context;
};
