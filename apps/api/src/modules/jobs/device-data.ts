import type { JobDeviceData } from '@msm/shared';
import { HttpError } from '../../lib/http-error.ts';
import { prisma } from '../../lib/prisma.ts';

export type ResolvedJobDevice = Omit<JobDeviceData, 'faults'> & {
  faults: { faultId: string; priceLabel: string | null; price: number | null }[];
};

/**
 * Validate all catalogue references for a multi-device job and snapshot selected prices.
 * Keeping this in one place makes create and pre-diagnosis edits enforce identical rules.
 */
export async function resolveJobDevices(devices: JobDeviceData[]) {
  const modelIds = [...new Set(devices.flatMap((d) => (d.deviceModelId ? [d.deviceModelId] : [])))];
  const faultIds = [...new Set(devices.flatMap((d) => d.faults.map((f) => f.faultId)))];
  const priceIds = [...new Set(devices.flatMap((d) => d.faults.flatMap((f) => (f.priceId ? [f.priceId] : []))))];

  const [models, faults, prices] = await Promise.all([
    prisma.deviceModel.findMany({ where: { id: { in: modelIds }, isActive: true }, select: { id: true, brandId: true } }),
    prisma.fault.findMany({
      where: { id: { in: faultIds }, isActive: true },
      select: { id: true, name: true, requiresIdProof: true },
    }),
    prisma.servicePrice.findMany({
      where: { id: { in: priceIds } },
      select: { id: true, faultId: true, deviceModelId: true, label: true, price: true },
    }),
  ]);

  const modelById = new Map(models.map((m) => [m.id, m]));
  const faultById = new Map(faults.map((f) => [f.id, f]));
  const priceById = new Map(prices.map((p) => [p.id, p]));

  const resolved: ResolvedJobDevice[] = devices.map((device, deviceIndex) => {
    if (device.jobType === 'MOBILE' && !device.manualBrand && !device.manualModel) {
      const model = device.deviceModelId ? modelById.get(device.deviceModelId) : undefined;
      if (!model || !device.brandId || model.brandId !== device.brandId) {
        throw HttpError.badRequest('Invalid request', { [`devices.${deviceIndex}.deviceModelId`]: ['Select a valid model for this brand'] });
      }
    }

    const resolvedFaults = device.faults.map(({ faultId, priceId }, faultIndex) => {
      if (!faultById.has(faultId)) {
        throw HttpError.badRequest('Invalid request', { [`devices.${deviceIndex}.faults.${faultIndex}`]: ['Unknown or inactive fault'] });
      }
      if (!priceId) return { faultId, priceLabel: null, price: null };
      const price = priceById.get(priceId);
      if (!price || price.faultId !== faultId || price.deviceModelId !== device.deviceModelId) {
        throw HttpError.badRequest('Invalid request', { [`devices.${deviceIndex}.faults.${faultIndex}`]: ['This price is not valid for the selected model and fault'] });
      }
      return { faultId, priceLabel: price.label, price: price.price.toNumber() };
    });

    return { ...device, faults: resolvedFaults };
  });

  const selectedFaultIds = new Set(resolved.flatMap((d) => d.faults.map((f) => f.faultId)));
  const requiresIdProofNames = faults
    .filter((f) => selectedFaultIds.has(f.id) && f.requiresIdProof)
    .map((f) => f.name);
  const selectedPrices = resolved.flatMap((d) => d.faults.flatMap((f) => (f.price === null ? [] : [f.price]))) as number[];
  const estimatedAmount = selectedPrices.length
    ? Math.round(selectedPrices.reduce((sum, price) => sum + price, 0) * 100) / 100
    : null;

  return { devices: resolved, requiresIdProofNames, estimatedAmount };
}
