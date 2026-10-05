import { Button } from './Button';

export function FormActions({ onCancel, loading, submitLabel = 'Save' }: { onCancel: () => void; loading: boolean; submitLabel?: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" loading={loading}>
        {submitLabel}
      </Button>
    </div>
  );
}
