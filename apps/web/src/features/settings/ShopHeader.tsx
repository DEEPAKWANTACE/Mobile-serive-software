import { AuthImage } from '@/features/jobs/AuthImage';
import { useShopSettings } from './useShopSettings';

/**
 * Shop identity block for printed documents: logo, name, legal name, GSTIN, contact, email, then the branch line.
 * `compact` (job sheet) drops the legal name, GSTIN and branch line.
 */
export function ShopHeader({ branch, compact = false }: { branch: { name: string; address: string | null; phone: string | null }; compact?: boolean }) {
  const { data: shop } = useShopSettings();
  return (
    <div className="flex items-start gap-3">
      {shop?.hasLogo && (
        <AuthImage src={`/settings/shop/logo?v=${shop.logoVersion}`} alt="Logo" className="h-12 w-auto max-w-24 object-contain" />
      )}
      <div>
        <div className="text-base font-bold">{shop?.shopName ?? branch.name}</div>
        {!compact && shop?.legalName && <div className="text-xs text-slate-600">{shop.legalName}</div>}
        {!compact && shop?.gstin && <div className="text-xs font-medium">GSTIN: {shop.gstin}</div>}
        {(shop?.address || shop?.phone) && (
          <div className="text-xs font-medium text-slate-900">
            {shop.address}
            {shop.address && shop.phone && ' · '}
            {shop.phone && `Ph: ${shop.phone}`}
          </div>
        )}
        {shop?.email && <div className="text-xs font-medium text-slate-900">Email: {shop.email}</div>}
        {!compact && <div className="text-xs text-slate-600">
          {branch.name}
          {branch.address && ` · ${branch.address}`}
          {branch.phone && ` · Ph: ${branch.phone}`}
        </div>}
      </div>
    </div>
  );
}
