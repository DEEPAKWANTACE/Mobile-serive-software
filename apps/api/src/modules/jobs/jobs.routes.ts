import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  engineerListQuerySchema,
  idParamSchema,
  jobAssignSchema,
  jobStatsQuerySchema,
  jobCreateSchema,
  jobListQuerySchema,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_PER_UPLOAD,
  photoUploadSchema,
  ROLES,
} from '@msm/shared';
import { authorize } from '../../middleware/authorize.ts';
import { validate } from '../../middleware/validate.ts';
import * as controller from './jobs.controller.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: PHOTO_MAX_PER_UPLOAD },
});

const photoParams = z.object({ id: z.uuid(), photoId: z.uuid() });

export const jobRoutes = Router();

// Storekeeper / accounts access is added with their workflow modules.
// Engineers are further limited (in the service) to jobs assigned to them.
const viewers = [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO, ROLES.ENGINEER] as const;
const creators = [ROLES.BRANCH_MANAGER, ROLES.CCO] as const;
const assigners = [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO] as const;

jobRoutes.get('/', authorize(...viewers), validate({ query: jobListQuerySchema }), controller.list);
jobRoutes.post('/', authorize(...creators), validate({ body: jobCreateSchema }), controller.create);
// Static paths before "/:id".
jobRoutes.get('/stats', authorize(...viewers), validate({ query: jobStatsQuerySchema }), controller.stats);
jobRoutes.get('/engineers', authorize(...assigners), validate({ query: engineerListQuerySchema }), controller.engineers);
jobRoutes.get('/:id', authorize(...viewers), validate({ params: idParamSchema }), controller.get);
jobRoutes.post(
  '/:id/assign',
  authorize(...assigners),
  validate({ params: idParamSchema, body: jobAssignSchema }),
  controller.assign,
);
jobRoutes.get('/:id/history', authorize(...viewers), validate({ params: idParamSchema }), controller.history);
jobRoutes.post(
  '/:id/photos',
  authorize(...creators),
  validate({ params: idParamSchema }),
  upload.array('photos', PHOTO_MAX_PER_UPLOAD),
  validate({ body: photoUploadSchema }),
  controller.addPhotos,
);
jobRoutes.get('/:id/photos/:photoId', authorize(...viewers), validate({ params: photoParams }), controller.getPhoto);
