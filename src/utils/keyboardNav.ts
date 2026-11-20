import { useEffect } from 'react';

/**
 * Handles PC/Laptop keyboard navigation across forms and interactive controls:
 * - Pressing Enter inside a form input/select advances focus to the next interactive field
 *   (skipping tabIndex=-1 or [data-skip-enter="true"] toggles like password eye buttons),
 *   and submits cleanly when on the last field.
 * - Leaves textareas, buttons, and [data-enter-action="custom"] inputs untouched.
 */
export function useFormKeyboardNavigation() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;

      const activeEl = document.activeElement as HTMLElement | null;
      if (!activeEl) return;

      if (activeEl.getAttribute('data-enter-action') === 'custom') return;

      const isInput = activeEl.tagName === 'INPUT';
      const isSelect = activeEl.tagName === 'SELECT';
      const inputType = isInput ? (activeEl as HTMLInputElement).type : '';

      if (
        (isInput && inputType !== 'submit' && inputType !== 'button' && inputType !== 'reset') ||
        isSelect
      ) {
        const form = activeEl.closest('form');
        if (!form) return;

        e.preventDefault();
        const focusables = Array.from(
          form.querySelectorAll<HTMLElement>(
            'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
          )
        ).filter(
          (el) =>
            el.tabIndex !== -1 &&
            el.getAttribute('data-skip-enter') !== 'true' &&
            el.offsetParent !== null
        );

        const index = focusables.indexOf(activeEl);
        if (index === -1) return;

        // If the next focusable is the submit button or we're on the last input before submit, advance or submit
        const nextEl = focusables[index + 1];
        if (!nextEl) {
          const submitBtn = form.querySelector<HTMLElement>('button[type="submit"]:not([disabled])');
          if (submitBtn) submitBtn.click();
          return;
        }

        if (nextEl.tagName === 'BUTTON' && (nextEl as HTMLButtonElement).type === 'submit') {
          nextEl.click();
          return;
        }

        nextEl.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
