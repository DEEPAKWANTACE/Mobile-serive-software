import { useQuery } from '@tanstack/react-query';
import type { ShopSettingsDto } from '@msm/shared';
import { api } from '@/lib/api-client';

export const useShopSettings = () =>
  useQuery({ queryKey: ['settings', 'shop'], queryFn: () => api.get<ShopSettingsDto>('/settings/shop'), staleTime: 5 * 60_000 });
