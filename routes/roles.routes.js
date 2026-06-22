import express from 'express';
import { verifyCinemaAdminAccessToken } from '../middleware/verifyCinemaAdmin.js';
import { requirePermission } from '../middleware/requirePermission.js';
import * as rolesController from '../controllers/roles.Controller.js';

const router = express.Router();

// All routes require auth
router.use(verifyCinemaAdminAccessToken);

// Read operations — anyone with roles.read can list/view roles
router.get('/', requirePermission('roles.read'), rolesController.listRoles);
router.get('/:id', requirePermission('roles.read'), rolesController.getRole);

// Write operations — require roles.manage
router.post('/', requirePermission('roles.manage'), rolesController.createRole);
router.patch('/:id', requirePermission('roles.manage'), rolesController.updateRole);
router.delete('/:id', requirePermission('roles.manage'), rolesController.deleteRole);
router.post('/:id/clone', requirePermission('roles.manage'), rolesController.cloneRole);

export default router;
