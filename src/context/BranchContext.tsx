import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase/config';

const BRANCH_STORAGE_KEY = 'gastrolab_selected_branch';
export const MAX_BRANCHES = 3;
const DEFAULT_BRANCHES = ['Matriz'];

export function configuredBranches(entries: unknown): string[] {
  const branches = new Map([['matriz', 'Matriz']]);
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const value = typeof entry === 'string' ? entry : entry?.name;
      if (typeof value !== 'string') continue;
      const name = value.trim();
      if (name && !branches.has(name.toLowerCase())) branches.set(name.toLowerCase(), name);
      if (branches.size === MAX_BRANCHES) break;
    }
  }
  return [...branches.values()];
}

export function normalizeBranchName(branch?: string | null): string {
  const trimmed = (branch || '').trim();
  return trimmed.length > 0 ? trimmed : 'Matriz';
}

export function belongsToBranch(docBranch: string | undefined | null, activeBranch: string): boolean {
  const normalizedDoc = normalizeBranchName(docBranch);
  const normalizedActive = normalizeBranchName(activeBranch);
  return normalizedDoc.toLowerCase() === normalizedActive.toLowerCase();
}

export function getBranchSlug(branch?: string | null): string {
  return normalizeBranchName(branch)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'matriz';
}

/**
 * Keeps legacy Matriz table IDs (`mesa_1`, `mesa_2`, ...) intact while isolating
 * additional branches (`sucursal_1_mesa_1`, ...) so tables never collide in Firestore.
 */
export function getBranchTableDocId(tableNumber: number, branch?: string | null): string {
  const norm = normalizeBranchName(branch);
  if (norm.toLowerCase() === 'matriz') {
    return `mesa_${tableNumber}`;
  }
  return `${getBranchSlug(norm)}_mesa_${tableNumber}`;
}

interface BranchContextType {
  activeBranch: string;
  setActiveBranch: (branch: string) => void;
  availableBranches: string[];
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

const areSameStringList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, idx) => item === b[idx]);

export const BranchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeBranch, setActiveBranchState] = useState<string>(() => {
    try {
      return normalizeBranchName(localStorage.getItem(BRANCH_STORAGE_KEY));
    } catch {
      return 'Matriz';
    }
  });

  const [branchesLoaded, setBranchesLoaded] = useState(false);
  const [availableBranches, setAvailableBranches] = useState<string[]>(DEFAULT_BRANCHES);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    auth.authStateReady().then(() => {
      if (cancelled) return;
      unsub = onSnapshot(
        doc(db, 'settings', 'general'),
        (snap) => {
          if (!snap.metadata.fromCache || snap.exists()) setBranchesLoaded(true);
          if (!snap.exists()) {
            setAvailableBranches((prev) => (areSameStringList(prev, DEFAULT_BRANCHES) ? prev : DEFAULT_BRANCHES));
            return;
          }
          const nextList = configuredBranches(snap.data().branches);
          setAvailableBranches((prev) => (areSameStringList(prev, nextList) ? prev : nextList));
        },
        () => {
          setAvailableBranches((prev) => (areSameStringList(prev, DEFAULT_BRANCHES) ? prev : DEFAULT_BRANCHES));
        }
      );
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, []);

  const setActiveBranch = useCallback((branch: string) => {
    const clean = normalizeBranchName(branch);
    setActiveBranchState(clean);
    try {
      localStorage.setItem(BRANCH_STORAGE_KEY, clean);
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  useEffect(() => {
    if (branchesLoaded && !availableBranches.includes(activeBranch)) {
      setActiveBranch(availableBranches[0]);
    }
  }, [activeBranch, availableBranches, branchesLoaded, setActiveBranch]);

  const contextValue = useMemo<BranchContextType>(
    () => ({ activeBranch, setActiveBranch, availableBranches }),
    [activeBranch, setActiveBranch, availableBranches]
  );

  return (
    <BranchContext.Provider value={contextValue}>
      {children}
    </BranchContext.Provider>
  );
};

export function useBranch(): BranchContextType {
  const ctx = useContext(BranchContext);
  if (!ctx) {
    throw new Error('useBranch debe utilizarse dentro de un BranchProvider');
  }
  return ctx;
}
