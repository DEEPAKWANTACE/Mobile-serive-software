import type { ListQuery, Paginated } from '@msm/shared';

export const pageArgs = ({ page, pageSize }: ListQuery) => ({ skip: (page - 1) * pageSize, take: pageSize });

export const toPage = <T>(items: T[], total: number, { page, pageSize }: ListQuery): Paginated<T> => ({
  items,
  total,
  page,
  pageSize,
});

/** Case-insensitive "contains" filter for Prisma string fields. */
export const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });
