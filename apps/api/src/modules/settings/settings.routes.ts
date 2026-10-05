import { Router } from 'express';
import multer from 'multer';
import { PHOTO_MAX_BYTES, ROLES, shopSettingsSchema } from '@msm/shared';
import { actorOf } from '../../lib/request-context.ts';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as service from './settings.service.ts';

export const settingsRoutes = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PHOTO_MAX_BYTES, files: 1 } });

// Any signed-in user reads them (invoice / job sheet printing); only Super Admin changes them.
settingsRoutes.get('/shop', async (_req, res) => {
  res.json(await service.get());
});
settingsRoutes.put('/shop', authorize(ROLES.SUPER_ADMIN), validate({ body: shopSettingsSchema }), async (req, res) => {
  res.json(await service.update(req.body, actorOf(req)));
});
settingsRoutes.put('/shop/logo', authorize(ROLES.SUPER_ADMIN), upload.single('logo'), async (req, res) => {
  res.json(await service.setLogo(req.file, actorOf(req)));
});
settingsRoutes.get('/shop/logo', async (_req, res) => {
  const { stream, mimeType } = await service.logo();
  res.set({ 'Content-Type': mimeType, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  stream.pipe(res);
});
