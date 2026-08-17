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
import { requirePermission } from "../middleware/requirePermission.js";

const router = express.Router();

// Public — legacy backward compat (used by customer booking flow)
router.get("/", getSettings);

// ── Organization-level settings ────────────────────────────────────
// Writes were gated on verifySuperAdmin, which locked org owners out of
// their own General/Payment settings. Ownership is expressed by the
// settings.org.update permission instead; superAdmin still bypasses.
router.get("/org", verifyCinemaAdminAccessToken, requirePermission('settings.org.read'), getOrgSettings);
router.patch("/org", verifyCinemaAdminAccessToken, requirePermission('settings.org.update'), updateOrgSettings);

// ── Hall-level settings ────────────────────────────────────────────
router.get("/hall/:hallId", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('settings.hall.read'), getHallSettings);
router.patch("/hall/:hallId", verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('settings.hall.update'), updateHallSettings);

// ── User-level settings ────────────────────────────────────────────
router.get("/user", verifyCinemaAdminAccessToken, requirePermission('settings.user.read'), getUserSettings);
router.patch("/user", verifyCinemaAdminAccessToken, requirePermission('settings.user.update'), updateUserSettings);

// Legacy PUT (super admin only) — delegates to org settings
router.put("/", verifyCinemaAdminAccessToken, verifySuperAdmin, updateSettings);

export default router;
