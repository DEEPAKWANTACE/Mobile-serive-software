import { useState } from 'react';
import { toast } from 'sonner';
import { useSave } from '@/lib/crud';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';

type Props = {
  resource: string;
  id: string;
  name: string;
  isActive: boolean;
  /** Extra consequence shown when deactivating. */
  warning?: string;
};

/** Activate / deactivate button with confirmation. Records are never hard-deleted. */
export function StatusToggle({ resource, id, name, isActive, warning }: Props) {
  const [open, setOpen] = useState(false);
  const save = useSave<{ isActive: boolean }>(resource);

  const confirm = () =>
    save.mutate(
      { id, data: { isActive: !isActive } },
      {
        onSuccess: () => {
          toast.success(`${name} ${isActive ? 'deactivated' : 'activated'}`);
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );

  return (
    <>
      <Button variant="link" className={isActive ? 'text-red-600!' : ''} onClick={() => setOpen(true)}>
        {isActive ? 'Deactivate' : 'Activate'}
      </Button>
      <ConfirmDialog
        open={open}
        title={`${isActive ? 'Deactivate' : 'Activate'} ${name}?`}
        message={isActive ? `${name} will be hidden from selection lists. ${warning ?? ''}` : `${name} will be available again.`}
        confirmLabel={isActive ? 'Deactivate' : 'Activate'}
        danger={isActive}
        loading={save.isPending}
        onConfirm={confirm}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
