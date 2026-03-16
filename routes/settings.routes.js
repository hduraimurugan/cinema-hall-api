import express from "express";
import { getSettings, updateSettings } from "../controllers/settings.Controller.js";
import { verifySuperAdmin, verifyCinemaAdminAccessToken } from "../middleware/verifyCinemaAdmin.js";

const router = express.Router();

// Public - anyone can read settings (needed by booking flow)
router.get("/", getSettings);

// Super Admin only - update settings
router.put("/", verifyCinemaAdminAccessToken, verifySuperAdmin, updateSettings);

export default router;
