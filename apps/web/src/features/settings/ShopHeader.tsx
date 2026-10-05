import { AuthImage } from '@/features/jobs/AuthImage';
import { useShopSettings } from './useShopSettings';

/** Shop identity block for printed documents: logo, name, legal name, GSTIN, then the branch line. */
export function ShopHeader({ branch }: { branch: { name: string; address: string | null; phone: string | null } }) {
  const { data: shop } = useShopSettings();
  return (
    <div className="flex items-start gap-3">
      {shop?.hasLogo && (
        <AuthImage src={`/settings/shop/logo?v=${shop.logoVersion}`} alt="Logo" className="h-12 w-auto max-w-24 object-contain" />
      )}
      <div>
        <div className="text-base font-bold">{shop?.shopName ?? branch.name}</div>
        {shop?.legalName && <div className="text-xs text-slate-600">{shop.legalName}</div>}
        {shop?.gstin && <div className="text-xs font-medium">GSTIN: {shop.gstin}</div>}
        <div className="text-xs text-slate-600">
          {branch.name}
          {branch.address && ` · ${branch.address}`}
          {branch.phone && ` · Ph: ${branch.phone}`}
        </div>
      </div>
    </div>
  );
}
