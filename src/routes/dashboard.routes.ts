import { Router } from "express";
import { authenticate, attachOrgContext } from "../middleware/auth";
import { getSummary, getCoverageMetrics, triggerSync } from "../controllers/dashboard.controller";

const router = Router();

router.get("/summary", authenticate, attachOrgContext, getSummary);
router.get("/coverage", authenticate, getCoverageMetrics);
router.post("/sync", authenticate, triggerSync);

export default router;
