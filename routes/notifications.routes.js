import express from 'express';
import { handleDispatch } from '../services/notification/dispatch.Controller.js';
import { identifyRecipient } from '../middleware/identifyRecipient.js';
import {
    listNotifications,
    getUnreadCount,
    markAsRead,
    markAllRead,
    getPreferences,
    updatePreferences,
} from '../controllers/notifications.Controller.js';

const router = express.Router();

// QStash webhook target — NO customer/admin auth, verified by Upstash-Signature.
// express.raw() keeps req.body as a Buffer so the signature check sees the
// exact bytes QStash signed (same pattern as the payment webhook route).
router.post('/dispatch', express.raw({ type: '*/*' }), handleDispatch);

// In-app notification center — shared by customers and admins.
// identifyRecipient tries the customer cookie, then the admin cookie.
router.get('/', identifyRecipient, listNotifications);
router.get('/unread-count', identifyRecipient, getUnreadCount);
router.patch('/read-all', identifyRecipient, markAllRead);
router.patch('/:id/read', identifyRecipient, markAsRead);
router.get('/preferences', identifyRecipient, getPreferences);
router.patch('/preferences', identifyRecipient, updatePreferences);

export default router;
