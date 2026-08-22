import express from "express";
import {
    getAllCinemaHalls,
    getAllOffers,
    getOfferById,
    createOffer,
    updateOffer,
    deleteOffer,
    getActiveOffers,
    validateOffer,
} from "../controllers/offers.Controller.js";
import {
    verifyCustomer,
    verifyCinemaAdminAccessToken,
} from "../middleware/verifyCinemaAdmin.js";
import { requirePermission } from "../middleware/requirePermission.js";

const router = express.Router();

// ── Customer routes (must be before /:id to avoid param capture) ──
router.get("/active", verifyCustomer, getActiveOffers);
router.post("/validate", verifyCustomer, validateOffer);

// ── Admin routes ────────────────────────────────────────────
// Offers are hall-scoped (offers.cinema_hall_id), so they are granted by
// permission rather than reserved for the platform superAdmin.
router.get("/cinema-halls", verifyCinemaAdminAccessToken, requirePermission('offers.create'), getAllCinemaHalls);
router.get("/", verifyCinemaAdminAccessToken, requirePermission('offers.read'), getAllOffers);
router.get("/:id", verifyCinemaAdminAccessToken, requirePermission('offers.read'), getOfferById);
router.post("/create", verifyCinemaAdminAccessToken, requirePermission('offers.create'), createOffer);
router.put("/update/:id", verifyCinemaAdminAccessToken, requirePermission('offers.update'), updateOffer);
router.delete("/delete/:id", verifyCinemaAdminAccessToken, requirePermission('offers.delete'), deleteOffer);

export default router;
