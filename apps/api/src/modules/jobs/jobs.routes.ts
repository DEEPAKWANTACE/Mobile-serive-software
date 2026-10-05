import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  movementListQuerySchemaL4,
  movementNoteSchema,
  sendToL4Schema,
  type L4MovementListQuery,
  callLogCreateSchema,
  deliverySchema,
  partRequestSchema,
  approvalSchema,
  rwrSchema,
  spareHoldSchema,
  spareReceivedSchema,
  transferListQuerySchema,
  transferRequestSchema,
  transferResponseSchema,
  diagnosisSchema,
  engineerListQuerySchema,
  statusChangeSchema,
  idParamSchema,
  jobAssignSchema,
  jobDeviceUpdateSchema,
  jobStatsQuerySchema,
  jobCreateSchema,
  jobListQuerySchema,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_PER_UPLOAD,
  photoUploadSchema,
  ROLES,
} from '@msm/shared';
import { authorize } from '../../middleware/authorize.ts';
import { multipartJson } from '../../middleware/multipart-json.ts';
import { validate } from '../../middleware/validate.ts';
import * as billing from '../billing/billing.controller.ts';
import * as calling from '../calling/calling.service.ts';
import { actorOf } from '../../lib/request-context.ts';
import * as inventory from '../inventory/inventory.controller.ts';
import * as controller from './jobs.controller.ts';
import * as l4 from './l4.service.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: PHOTO_MAX_PER_UPLOAD + 5 },
});

const photoParams = z.object({ id: z.uuid(), photoId: z.uuid() });

export const jobRoutes = Router();

// Storekeeper / accounts access is added with their workflow modules.
// Engineers are further limited (in the service) to jobs assigned to them.
const viewers = [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO, ROLES.ENGINEER] as const;
const creators = [ROLES.BRANCH_MANAGER, ROLES.CCO] as const;
const assigners = [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.CCO] as const;

jobRoutes.get('/', authorize(...viewers), validate({ query: jobListQuerySchema }), controller.list);
// Multipart: "data" (JSON job sheet) + optional CUSTOMER / ID_PROOF / DEVICE image files.
jobRoutes.post(
  '/',
  authorize(...creators),
  upload.fields([
    { name: 'CUSTOMER', maxCount: 1 },
    { name: 'ID_PROOF', maxCount: 4 },
    { name: 'DEVICE', maxCount: PHOTO_MAX_PER_UPLOAD },
  ]),
  multipartJson('data'),
  validate({ body: jobCreateSchema }),
  controller.create,
);
// Static paths before "/:id".
jobRoutes.get('/stats', authorize(...viewers), validate({ query: jobStatsQuerySchema }), controller.stats);
jobRoutes.get('/engineers', authorize(...viewers), validate({ query: engineerListQuerySchema }), controller.engineers);
// Transfers (static paths before "/:id")
const transferParams = z.object({ transferId: z.uuid() });
jobRoutes.get('/transfers', authorize(...viewers), validate({ query: transferListQuerySchema }), controller.listTransfers);
jobRoutes.get('/l4/movements', authorize(...assigners), validate({ query: movementListQuerySchemaL4 }), async (req, res) => {
  res.json(await l4.listMovements(res.locals.query as L4MovementListQuery, actorOf(req)));
});
jobRoutes.post(
  '/transfers/:transferId/respond',
  authorize(ROLES.ENGINEER),
  validate({ params: transferParams, body: transferResponseSchema }),
  controller.respondTransfer,
);
jobRoutes.post(
  '/transfers/:transferId/cancel',
  authorize(ROLES.ENGINEER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN),
  validate({ params: transferParams }),
  controller.cancelTransfer,
);
jobRoutes.get('/:id', authorize(...viewers), validate({ params: idParamSchema }), controller.get);
jobRoutes.post(
  '/:id/assign',
  authorize(...assigners),
  validate({ params: idParamSchema, body: jobAssignSchema }),
  controller.assign,
);
jobRoutes.patch(
  '/:id/device',
  authorize(...viewers),
  validate({ params: idParamSchema, body: jobDeviceUpdateSchema }),
  controller.updateDevice,
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

// ─── Workflow ───────────────────────────────────────────────────────────────
jobRoutes.put(
  '/:id/diagnosis',
  authorize(ROLES.ENGINEER),
  validate({ params: idParamSchema, body: diagnosisSchema }),
  controller.diagnose,
);
jobRoutes.post(
  '/:id/approval',
  authorize(...assigners),
  validate({ params: idParamSchema, body: approvalSchema }),
  controller.decideApproval,
);
jobRoutes.post(
  '/:id/status',
  authorize(ROLES.ENGINEER),
  validate({ params: idParamSchema, body: statusChangeSchema }),
  controller.changeStatus,
);
jobRoutes.post(
  '/:id/transfers',
  authorize(ROLES.ENGINEER),
  validate({ params: idParamSchema, body: transferRequestSchema }),
  controller.requestTransfer,
);
jobRoutes.post(
  '/:id/spare-hold',
  authorize(ROLES.ENGINEER),
  validate({ params: idParamSchema, body: spareHoldSchema }),
  controller.spareHold,
);
jobRoutes.post(
  '/:id/spare-received',
  authorize(ROLES.ENGINEER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN),
  validate({ params: idParamSchema, body: spareReceivedSchema }),
  controller.spareReceived,
);
// Multipart: "data" (JSON { reason, note }) + "photos" (motherboard images, at least one)
jobRoutes.post(
  '/:id/rwr',
  authorize(ROLES.ENGINEER),
  validate({ params: idParamSchema }),
  upload.array('photos', PHOTO_MAX_PER_UPLOAD),
  multipartJson('data'),
  validate({ body: rwrSchema }),
  controller.rwr,
);
jobRoutes.post(
  '/:id/parts',
  authorize(ROLES.ENGINEER),
  validate({ params: idParamSchema, body: partRequestSchema }),
  inventory.requestPart,
);

// ─── Delivery & billing (counter) ───────────────────────────────────────────
jobRoutes.get('/:id/bill-preview', authorize(...assigners), validate({ params: idParamSchema }), billing.preview);
jobRoutes.post('/:id/deliver', authorize(...assigners), validate({ params: idParamSchema, body: deliverySchema }), billing.deliver);
jobRoutes.get('/:id/invoice', authorize(...assigners), validate({ params: idParamSchema }), billing.invoice);

// ─── Customer calls ─────────────────────────────────────────────────────────
jobRoutes.get('/:id/calls', authorize(...assigners), validate({ params: idParamSchema }), async (req, res) => {
  res.json(await calling.jobCalls(req.params.id as string, actorOf(req)));
});
jobRoutes.post('/:id/calls', authorize(...assigners), validate({ params: idParamSchema, body: callLogCreateSchema }), async (req, res) => {
  res.status(201).json(await calling.logCall(req.params.id as string, req.body, actorOf(req)));
});

// ─── L4 / main office ───────────────────────────────────────────────────────
jobRoutes.post('/:id/l4/send', authorize(...viewers), validate({ params: idParamSchema, body: sendToL4Schema }), async (req, res) => {
  await l4.sendToL4(req.params.id as string, req.body, actorOf(req));
  res.status(204).end();
});
jobRoutes.post('/:id/l4/receive', authorize(...assigners), validate({ params: idParamSchema, body: movementNoteSchema }), async (req, res) => {
  await l4.receive(req.params.id as string, req.body.note, actorOf(req));
  res.status(204).end();
});
jobRoutes.post('/:id/l4/send-back', authorize(...viewers), validate({ params: idParamSchema, body: movementNoteSchema }), async (req, res) => {
  await l4.sendBack(req.params.id as string, req.body.note, actorOf(req));
  res.status(204).end();
});
