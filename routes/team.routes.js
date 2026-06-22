import express from 'express';
import { verifyCinemaAdminAccessToken } from '../middleware/verifyCinemaAdmin.js';
import { requirePermission } from '../middleware/requirePermission.js';
import * as teamController from '../controllers/team.Controller.js';

const router = express.Router();

router.use(verifyCinemaAdminAccessToken);
router.use(requirePermission('team.manage'));

router.get('/', teamController.listOrgMembers);
router.post('/invite', teamController.inviteMember);
router.post('/members', teamController.createMember);
router.get('/members/:id', teamController.getMember);
router.patch('/members/:id', teamController.updateMember);
router.delete('/members/:id', teamController.removeMember);
router.get('/members/:id/halls', teamController.getMemberHalls);
router.post('/members/:id/halls', teamController.assignHalls);
router.delete('/members/:id/halls/:hallId', teamController.removeHallAssignment);

export default router;
