import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError } from './api-client';

/** Puts API validation/conflict errors under their form fields; anything else becomes a toast. */
export function handleFormError<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>) {
  if (err instanceof ApiError && err.details && typeof err.details === 'object') {
    let mapped = false;
    for (const [field, messages] of Object.entries(err.details as Record<string, string[] | undefined>)) {
      if (messages?.[0]) {
        setError(field as Path<T>, { message: messages[0] });
        mapped = true;
      }
    }
    if (mapped) {
      scrollToFirstError();
      return;
    }
  }
  toast.error(err instanceof Error ? err.message : 'Something went wrong');
}

/**
 * After a failed submit, scroll to the first field showing an error (top of the page first) and focus it.
 * Runs after the next paint so freshly rendered error messages are found.
 */
export function scrollToFirstError(root: ParentNode = document) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const el = root.querySelector<HTMLElement>('[data-field-error], [aria-invalid="true"]');
      if (!el) return;
      const field = el.closest('label, fieldset, section, [data-field]') ?? el;
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const input = (el.matches('input, select, textarea') ? el : field.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea'));
      input?.focus({ preventScroll: true });
    }),
  );
}
