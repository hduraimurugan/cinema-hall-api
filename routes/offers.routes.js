import express from "express";
import {
    getAllCinemaHalls,
    getAllOffers,
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

// ── Admin routes (superAdmin only) ──────────────────────────
router.get("/cinema-halls", verifySuperAdmin, getAllCinemaHalls);
router.get("/", verifySuperAdmin, getAllOffers);
router.post("/create", verifySuperAdmin, createOffer);
router.put("/update/:id", verifySuperAdmin, updateOffer);
router.delete("/delete/:id", verifySuperAdmin, deleteOffer);

// ── Customer routes ──────────────────────────────────────────
router.get("/active", verifyCustomer, getActiveOffers);
router.post("/validate", verifyCustomer, validateOffer);

export default router;
