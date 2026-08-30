import express from 'express';
import { verifySuperAdmin } from '../middleware/verifyCinemaAdmin.js';
import {
  getAllAds,
  createAd,
  updateAd,
  deleteAd,
  announceAdById,
  getAdClicks,
  getActiveAds,
  recordClick,
} from '../controllers/ads.Controller.js';

const router = express.Router();

// Public routes (no auth required)
router.get('/active', getActiveAds);
router.post('/click/:id', recordClick);

// Super admin only routes
router.get('/', verifySuperAdmin, getAllAds);
router.post('/create', verifySuperAdmin, createAd);
router.put('/update/:id', verifySuperAdmin, updateAd);
router.delete('/delete/:id', verifySuperAdmin, deleteAd);
router.post('/:id/announce', verifySuperAdmin, announceAdById);
router.get('/:id/clicks', verifySuperAdmin, getAdClicks);

export default router;
