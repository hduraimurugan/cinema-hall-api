import express from 'express';
import { verifyCinemaAdminAccessToken } from '../middleware/verifyCinemaAdmin.js';
import { getMyHalls, createHall, updateHall, deleteHall } from '../controllers/halls.Controller.js';
import { requirePermission } from '../middleware/requirePermission.js';

const router = express.Router();

// All routes require a valid admin access token.
// Note: requireActiveHall is NOT used here — these routes manage halls themselves,
// not data within a hall.
router.get('/',       verifyCinemaAdminAccessToken, requirePermission('halls.read'),   getMyHalls);
router.post('/',      verifyCinemaAdminAccessToken, requirePermission('halls.manage'), createHall);
router.put('/:id',    verifyCinemaAdminAccessToken, requirePermission('halls.manage'), updateHall);
router.delete('/:id', verifyCinemaAdminAccessToken, requirePermission('halls.manage'), deleteHall);

export default router;
