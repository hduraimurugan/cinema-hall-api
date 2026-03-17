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
    verifySuperAdmin,
    verifyCustomer,
} from "../middleware/verifyCinemaAdmin.js";

const router = express.Router();

// ── Customer routes (must be before /:id to avoid param capture) ──
router.get("/active", verifyCustomer, getActiveOffers);
router.post("/validate", verifyCustomer, validateOffer);

// ── Admin routes (superAdmin only) ──────────────────────────
router.get("/cinema-halls", verifySuperAdmin, getAllCinemaHalls);
router.get("/", verifySuperAdmin, getAllOffers);
router.get("/:id", verifySuperAdmin, getOfferById);
router.post("/create", verifySuperAdmin, createOffer);
router.put("/update/:id", verifySuperAdmin, updateOffer);
router.delete("/delete/:id", verifySuperAdmin, deleteOffer);

export default router;
