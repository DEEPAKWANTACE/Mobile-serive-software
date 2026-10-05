import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated } from '@msm/shared';
import { api } from './api-client';

type Params = Record<string, string | number | boolean | undefined | null>;

export const toQueryString = (params: Params) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();

/** Paginated list of a REST resource, e.g. useList<StateDto>('states', { page, search }). */
export function useList<T>(resource: string, params: Params = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [resource, 'list', params],
    queryFn: () => api.get<Paginated<T>>(`/${resource}?${toQueryString(params)}`),
    placeholderData: keepPreviousData,
    enabled: options.enabled,
  });
}

/** Active records for a dropdown. */
export function useOptions<T>(resource: string, params: Params = {}, options: { enabled?: boolean } = {}) {
  const query = useList<T>(resource, { isActive: true, pageSize: 200, ...params }, options);
  return { ...query, items: query.data?.items ?? [] };
}

/**
 * Create (no id) or update (PATCH, with id) a resource.
 * Invalidates every cached query since lists show counts from related resources.
 */
export function useSave<TInput, TResult = unknown>(resource: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: TInput }) =>
      id ? api.patch<TResult>(`/${resource}/${id}`, data) : api.post<TResult>(`/${resource}`, data),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
