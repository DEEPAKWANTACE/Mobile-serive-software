import { Router } from 'express';
import multer from 'multer';
import { accessoryOptionSchema, accessoryOptionsQuerySchema, accessoryOptionUpdateSchema, rejectionReasonSchema, rejectionReasonsQuerySchema, rejectionReasonUpdateSchema, branchOptionsSchema, branchWarrantySchema, diagnosisFindingSchema, diagnosisFindingSubcategorySchema, diagnosisFindingSubcategoryUpdateSchema, diagnosisFindingTypeSchema, diagnosisFindingTypeUpdateSchema, diagnosisFindingUpdateSchema, idParamSchema, jobListColumnsSchema, jobListModeSchema, PHOTO_MAX_BYTES, ROLES, shopSettingsSchema } from '@msm/shared';
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

settingsRoutes.get('/branch-warranty', authorize(ROLES.BRANCH_MANAGER, ROLES.CCO), async (req, res) => {
  res.json(await service.branchWarranty(actorOf(req)));
});
settingsRoutes.put('/branch-warranty', authorize(ROLES.BRANCH_MANAGER), validate({ body: branchWarrantySchema }), async (req, res) => {
  res.json(await service.updateBranchWarranty(req.body, actorOf(req)));
});

// Any signed-in user of the branch reads them (job sheet / delivery forms); Super Admin passes ?branchId.
settingsRoutes.get('/branch-options', async (req, res) => {
  res.json(await service.branchOptions(actorOf(req), typeof req.query.branchId === 'string' ? req.query.branchId : null));
});
settingsRoutes.put('/branch-options', authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER), validate({ body: branchOptionsSchema }), async (req, res) => {
  res.json(await service.updateBranchOptions(req.body, actorOf(req)));
});

settingsRoutes.get('/accessories', validate({ query: accessoryOptionsQuerySchema }), async (req, res) => {
  res.json(await service.accessoryOptions(res.locals.query as never, actorOf(req)));
});
settingsRoutes.post('/accessories', authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER), validate({ body: accessoryOptionSchema }), async (req, res) => {
  res.status(201).json(await service.createAccessoryOption(req.body, actorOf(req)));
});
settingsRoutes.patch('/accessories/:id', authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER), validate({ params: idParamSchema, body: accessoryOptionUpdateSchema }), async (req, res) => {
  res.json(await service.updateAccessoryOption(req.params.id as string, req.body, actorOf(req)));
});
// Customer rejection reasons: everyone reads the effective list; Super Admin / Branch Manager edit it.
settingsRoutes.get('/rejection-reasons', validate({ query: rejectionReasonsQuerySchema }), async (req, res) => {
  res.json(await service.rejectionReasons(res.locals.query as never, actorOf(req)));
});
settingsRoutes.post('/rejection-reasons', authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER), validate({ body: rejectionReasonSchema }), async (req, res) => {
  res.status(201).json(await service.createRejectionReason(req.body, actorOf(req)));
});
settingsRoutes.patch('/rejection-reasons/:id', authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER), validate({ params: idParamSchema, body: rejectionReasonUpdateSchema }), async (req, res) => {
  res.json(await service.updateRejectionReason(req.params.id as string, req.body, actorOf(req)));
});

settingsRoutes.get('/diagnosis-finding-types', async (req, res) => {
  res.json(await service.diagnosisFindingTypes(req.query.all === 'true', actorOf(req)));
});
settingsRoutes.post('/diagnosis-finding-types', authorize(ROLES.SUPER_ADMIN), validate({ body: diagnosisFindingTypeSchema }), async (req, res) => {
  res.status(201).json(await service.createDiagnosisFindingType(req.body, actorOf(req)));
});
settingsRoutes.patch('/diagnosis-finding-types/:id', authorize(ROLES.SUPER_ADMIN), validate({ params: idParamSchema, body: diagnosisFindingTypeUpdateSchema }), async (req, res) => {
  res.json(await service.updateDiagnosisFindingType(req.params.id as string, req.body, actorOf(req)));
});

settingsRoutes.get('/diagnosis-finding-subcategories', async (req, res) => {
  res.json(await service.diagnosisFindingSubcategories(req.query.all === 'true', actorOf(req)));
});
settingsRoutes.post('/diagnosis-finding-subcategories', authorize(ROLES.SUPER_ADMIN), validate({ body: diagnosisFindingSubcategorySchema }), async (req, res) => {
  res.status(201).json(await service.createDiagnosisFindingSubcategory(req.body, actorOf(req)));
});
settingsRoutes.patch('/diagnosis-finding-subcategories/:id', authorize(ROLES.SUPER_ADMIN), validate({ params: idParamSchema, body: diagnosisFindingSubcategoryUpdateSchema }), async (req, res) => {
  res.json(await service.updateDiagnosisFindingSubcategory(req.params.id as string, req.body, actorOf(req)));
});

settingsRoutes.get('/diagnosis-findings', async (req, res) => {
  res.json(await service.diagnosisFindings(req.query.all === 'true', actorOf(req)));
});
settingsRoutes.post('/diagnosis-findings', authorize(ROLES.SUPER_ADMIN), validate({ body: diagnosisFindingSchema }), async (req, res) => {
  res.status(201).json(await service.createDiagnosisFinding(req.body, actorOf(req)));
});
settingsRoutes.patch('/diagnosis-findings/:id', authorize(ROLES.SUPER_ADMIN), validate({ params: idParamSchema, body: diagnosisFindingUpdateSchema }), async (req, res) => {
  res.json(await service.updateDiagnosisFinding(req.params.id as string, req.body, actorOf(req)));
});

settingsRoutes.get('/job-list-columns', async (_req, res) => {
  res.json(await service.jobListColumns());
});
settingsRoutes.put('/job-list-columns', authorize(ROLES.SUPER_ADMIN), validate({ body: jobListColumnsSchema }), async (req, res) => {
  res.json(await service.updateJobListColumns(req.body, actorOf(req)));
});
settingsRoutes.get('/job-list-mode', async (_req, res) => {
  res.json(await service.jobListMode());
});
settingsRoutes.put('/job-list-mode', authorize(ROLES.SUPER_ADMIN), validate({ body: jobListModeSchema }), async (req, res) => {
  res.json(await service.updateJobListMode(req.body, actorOf(req)));
});
