import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BRANCH_STAFF_ROLES,
  ROLE_LABELS,
  ROLE_VALUES,
  ROLES,
  resetPasswordSchema,
  userCreateSchema,
  userEditFormSchema,
  type AuthUser,
  type BranchDto,
  type ResetPasswordInput,
  type Role,
  type UserCreateData,
  type UserCreateInput,
  type UserDto,
} from '@msm/shared';
import { StatusToggle } from '@/components/StatusToggle';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Field, inputClass } from '@/components/ui/Field';
import { FilterBar, FilterSelect, SearchInput, StatusFilter } from '@/components/ui/Filters';
import { FormActions } from '@/components/ui/FormActions';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/features/auth/auth-context';
import { AuthImage } from '@/features/jobs/AuthImage';
import { PhotoPicker } from '@/features/jobs/PhotoPicker';
import { compressImage } from '@/lib/image';
import { useListState } from '@/hooks/use-list-state';
import { api } from '@/lib/api-client';
import { useList, useOptions, useSave } from '@/lib/crud';
import { handleFormError } from '@/lib/form-errors';
import { formatDateTime } from '@/lib/format';

export function StaffPage() {
  const { user: me } = useAuth();
  const isSuperAdmin = me?.role === ROLES.SUPER_ADMIN;
  const manageableRoles: readonly Role[] = isSuperAdmin ? ROLE_VALUES : BRANCH_STAFF_ROLES;

  const list = useListState({ branchId: '', role: '' });
  const { data, isLoading } = useList<UserDto>('users', list.params);
  const { items: branches } = useOptions<BranchDto>('branches', {}, { enabled: isSuperAdmin });

  const [editing, setEditing] = useState<UserDto | 'new' | null>(null);
  const [resetting, setResetting] = useState<UserDto | null>(null);

  if (!me) return null;
  const canManage = (u: UserDto) => isSuperAdmin || BRANCH_STAFF_ROLES.includes(u.role);

  const columns: Column<UserDto>[] = [
    {
      header: 'Name',
      cell: (u) => (
        <div>
          <div className="font-medium">{u.name}</div>
          <div className="text-xs text-slate-500">@{u.username}</div>
        </div>
      ),
    },
    { header: 'Role', cell: (u) => ROLE_LABELS[u.role] },
    { header: 'Branch', cell: (u) => (u.branch ? `${u.branch.name} (${u.branch.code})` : 'All branches') },
    { header: 'Phone', cell: (u) => u.phone ?? '—' },
    { header: 'Last login', cell: (u) => <span className="whitespace-nowrap text-slate-600">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</span> },
    { header: 'Status', cell: (u) => <StatusBadge active={u.isActive} /> },
    {
      header: 'Actions',
      className: 'text-right',
      cell: (u) =>
        canManage(u) && (
          <div className="flex justify-end gap-3 whitespace-nowrap">
            <Button variant="link" onClick={() => setEditing(u)}>
              Edit
            </Button>
            <Button variant="link" onClick={() => setResetting(u)}>
              Reset password
            </Button>
            {u.id !== me.id && (
              <StatusToggle
                resource="users"
                id={u.id}
                name={u.name}
                isActive={u.isActive}
                warning="They will be signed out and cannot sign in."
              />
            )}
          </div>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Staff"
        description={isSuperAdmin ? 'User accounts across all branches' : `Staff accounts of ${me.branch?.name ?? 'your branch'}`}
        actions={<Button onClick={() => setEditing('new')}>Add staff</Button>}
      />
      <FilterBar>
        <SearchInput onSearch={list.setSearch} placeholder="Search name, username, phone" />
        {isSuperAdmin && (
          <FilterSelect
            value={list.filters.branchId}
            onChange={(v) => list.setFilter('branchId', v)}
            placeholder="All branches"
            options={branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))}
          />
        )}
        <FilterSelect
          value={list.filters.role}
          onChange={(v) => list.setFilter('role', v)}
          placeholder="All roles"
          options={ROLE_VALUES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
        />
        <StatusFilter value={list.status} onChange={list.setStatus} />
      </FilterBar>
      <DataTable columns={columns} rows={data?.items} rowKey={(u) => u.id} isLoading={isLoading} />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={list.setPage} />}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add staff' : 'Edit staff'} size="lg">
        {editing && (
          <StaffForm
            user={editing === 'new' ? undefined : editing}
            me={me}
            roles={manageableRoles}
            branches={branches}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>

      <Modal open={resetting !== null} onClose={() => setResetting(null)} title={`Reset password — ${resetting?.name ?? ''}`} size="sm">
        {resetting && <ResetPasswordForm user={resetting} onDone={() => setResetting(null)} />}
      </Modal>
    </div>
  );
}

type StaffFormProps = {
  user?: UserDto;
  me: AuthUser;
  roles: readonly Role[];
  branches: BranchDto[];
  onDone: () => void;
};

function StaffForm({ user, me, roles, branches, onDone }: StaffFormProps) {
  const isSuperAdmin = me.role === ROLES.SUPER_ADMIN;
  const isSelf = user?.id === me.id;
  const save = useSave<Omit<UserCreateData, 'password'> | UserCreateData, UserDto>('users');
  const [aadhaarPhoto, setAadhaarPhoto] = useState<File[]>([]);
  const queryClient = useQueryClient();

  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm<UserCreateInput, unknown, UserCreateData>({
    // Edit form has the same fields minus password; cast keeps one typed form for both modes.
    resolver: zodResolver((user ? userEditFormSchema : userCreateSchema) as typeof userCreateSchema),
    defaultValues: {
      name: user?.name ?? '',
      username: user?.username ?? '',
      phone: user?.phone ?? '',
      email: user?.email ?? '',
      address: user?.address ?? '',
      aadhaarNumber: user?.aadhaarNumber ?? '',
      role: user?.role ?? (roles.includes(ROLES.ENGINEER) ? ROLES.ENGINEER : roles[0]),
      branchId: user ? user.branch?.id ?? null : isSuperAdmin ? null : me.branch?.id ?? null,
      password: '',
    },
  });
  const role = watch('role');

  const onSubmit = handleSubmit((data) =>
    save.mutate(
      { id: user?.id, data: user ? (({ password: _, ...rest }) => rest)(data) : data },
      {
        onSuccess: async (saved) => {
          if (aadhaarPhoto[0]) {
            const form = new FormData();
            form.append('photo', await compressImage(aadhaarPhoto[0]), 'aadhaar.jpg');
            await api.put(`/users/${saved.id}/aadhaar-photo`, form).catch((e: Error) => toast.error(`Aadhaar photo: ${e.message}`));
            // The list was refreshed before the upload finished; refresh again and drop the cached old image.
            queryClient.removeQueries({ queryKey: ['blob', `/users/${saved.id}/aadhaar-photo`] });
            await queryClient.invalidateQueries({ queryKey: ['users'] });
          }
          toast.success(user ? 'Staff updated' : 'Staff account created');
          onDone();
        },
        onError: (err) => handleFormError(err, setError),
      },
    ),
  );

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Full name" required error={errors.name?.message}>
        <input {...register('name')} className={inputClass} aria-invalid={!!errors.name} />
      </Field>
      <Field label="Username" required error={errors.username?.message} hint="Used to sign in">
        <input {...register('username')} autoComplete="off" className={`${inputClass} lowercase`} aria-invalid={!!errors.username} />
      </Field>
      <Field label="Mobile number" error={errors.phone?.message}>
        <input {...register('phone')} inputMode="numeric" maxLength={10} className={inputClass} aria-invalid={!!errors.phone} />
      </Field>
      <Field label="Email" error={errors.email?.message}>
        <input {...register('email')} type="email" className={inputClass} aria-invalid={!!errors.email} />
      </Field>
      {/* Own role/branch are shown read-only; their stored values still submit from defaultValues. */}
      {isSelf ? (
        <Field label="Role" hint="You cannot change your own role or branch">
          <input value={ROLE_LABELS[user.role]} disabled className={inputClass} />
        </Field>
      ) : (
        <Field label="Role" required error={errors.role?.message}>
          <select {...register('role')} className={inputClass}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
      )}
      {role !== ROLES.SUPER_ADMIN &&
        (isSuperAdmin && !isSelf ? (
          <Field label="Branch" required error={errors.branchId?.message}>
            <select
              {...register('branchId', { setValueAs: (v: string | null) => v || null })}
              className={inputClass}
              aria-invalid={!!errors.branchId}
            >
              <option value="">Select branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Branch">
            <input value={(isSelf ? user?.branch?.name : me.branch?.name) ?? ''} disabled className={inputClass} />
          </Field>
        ))}
      <Field label="Address" error={errors.address?.message} className="sm:col-span-2">
        <input {...register('address')} className={inputClass} />
      </Field>
      <Field label="Aadhaar number" error={errors.aadhaarNumber?.message} hint="12 digits">
        <input {...register('aadhaarNumber')} inputMode="numeric" maxLength={14} className={`${inputClass} font-mono`} />
      </Field>
      <div>
        {user?.hasAadhaarPhoto && !aadhaarPhoto.length && (
          <div className="mb-2">
            <div className="mb-1 text-sm font-medium text-slate-700">Aadhaar photo (saved)</div>
            <AuthImage src={`/users/${user.id}/aadhaar-photo`} alt="Aadhaar" className="h-24 rounded ring-1 ring-slate-200" />
          </div>
        )}
        <PhotoPicker
          label={user?.hasAadhaarPhoto ? 'Replace Aadhaar photo' : 'Aadhaar photo'}
          files={aadhaarPhoto}
          onChange={setAadhaarPhoto}
        />
      </div>
      {!user && (
        <Field label="Password" required error={errors.password?.message} hint="Minimum 8 characters">
          <input {...register('password')} type="password" autoComplete="new-password" className={inputClass} aria-invalid={!!errors.password} />
        </Field>
      )}
      <div className="sm:col-span-2">
        <FormActions onCancel={onDone} loading={save.isPending} />
      </div>
    </form>
  );
}

function ResetPasswordForm({ user, onDone }: { user: UserDto; onDone: () => void }) {
  const reset = useMutation({
    mutationFn: (data: ResetPasswordInput) => api.post(`/users/${user.id}/reset-password`, data),
  });
  const { register, handleSubmit, setError, formState: { errors } } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '' },
  });

  const onSubmit = handleSubmit((data) =>
    reset.mutate(data, {
      onSuccess: () => {
        toast.success(`Password reset for ${user.name}`);
        onDone();
      },
      onError: (err) => handleFormError(err, setError),
    }),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-slate-600">{user.name} will be signed out of all devices and must use the new password.</p>
      <Field label="New password" required error={errors.password?.message} hint="Minimum 8 characters">
        <input {...register('password')} type="password" autoComplete="new-password" autoFocus className={inputClass} aria-invalid={!!errors.password} />
      </Field>
      <FormActions onCancel={onDone} loading={reset.isPending} submitLabel="Reset password" />
    </form>
  );
}
