import express from 'express';
import { verifyCinemaAdminAccessToken } from '../middleware/verifyCinemaAdmin.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { getAuditLogs } from '../controllers/auditLogs.Controller.js';

const router = express.Router();

router.use(verifyCinemaAdminAccessToken);
router.get('/', requirePermission('audit.view'), getAuditLogs);

export default router;
