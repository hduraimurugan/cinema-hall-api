import express from 'express';
import { verifyCinemaAdminAccessToken } from '../middleware/verifyCinemaAdmin.js';
import { listApiKeys, createApiKey, revokeApiKey, getApiKeyContext } from '../controllers/apiKeys.Controller.js';

const router = express.Router();

// Self-service key management — no special permission required, same
// posture as changing your own password. Team-manage escalation for
// revoking a teammate's key is handled inside the controller.
router.get('/context', verifyCinemaAdminAccessToken, getApiKeyContext);
router.get('/',         verifyCinemaAdminAccessToken, listApiKeys);
router.post('/',        verifyCinemaAdminAccessToken, createApiKey);
router.delete('/:id',   verifyCinemaAdminAccessToken, revokeApiKey);

export default router;
