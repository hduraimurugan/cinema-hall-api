import express from 'express';
import { verifyCinemaAdminAccessToken } from '../middleware/verifyCinemaAdmin.js';
import { getMyHalls, createHall, updateHall, deleteHall } from '../controllers/halls.Controller.js';

const router = express.Router();

// All routes require a valid admin access token.
// Note: requireActiveHall is NOT used here — these routes manage halls themselves,
// not data within a hall.
router.get('/',       verifyCinemaAdminAccessToken, getMyHalls);
router.post('/',      verifyCinemaAdminAccessToken, createHall);
router.put('/:id',    verifyCinemaAdminAccessToken, updateHall);
router.delete('/:id', verifyCinemaAdminAccessToken, deleteHall);

export default router;
