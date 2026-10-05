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
    if (mapped) return;
  }
  toast.error(err instanceof Error ? err.message : 'Something went wrong');
}
