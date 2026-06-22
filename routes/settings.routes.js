import express from "express";
import {
  getSettings,
  updateSettings,
  getOrgSettings,
  updateOrgSettings,
  getHallSettings,
  updateHallSettings,
  getUserSettings,
  updateUserSettings,
} from "../controllers/settings.Controller.js";
import {
  verifySuperAdmin,
  verifyCinemaAdminAccessToken,
  requireActiveHall,
} from "../middleware/verifyCinemaAdmin.js";

const router = express.Router();

// Public — legacy backward compat (used by customer booking flow)
router.get("/", getSettings);

// ── Organization-level settings (super admin only for Phase 1) ────
router.get("/org", verifyCinemaAdminAccessToken, getOrgSettings);
router.patch("/org", verifyCinemaAdminAccessToken, verifySuperAdmin, updateOrgSettings);

// ── Hall-level settings ────────────────────────────────────────────
router.get("/hall/:hallId", verifyCinemaAdminAccessToken, requireActiveHall, getHallSettings);
router.patch("/hall/:hallId", verifyCinemaAdminAccessToken, requireActiveHall, updateHallSettings);

// ── User-level settings ────────────────────────────────────────────
router.get("/user", verifyCinemaAdminAccessToken, getUserSettings);
router.patch("/user", verifyCinemaAdminAccessToken, updateUserSettings);

// Legacy PUT (super admin only) — delegates to org settings
router.put("/", verifyCinemaAdminAccessToken, verifySuperAdmin, updateSettings);

export default router;
