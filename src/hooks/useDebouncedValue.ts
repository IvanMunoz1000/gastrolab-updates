import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of `value` after `delayMs` milliseconds.
 * Prevents heavy list filtering/recalculation on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = 180): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
