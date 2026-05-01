import { Router } from "express";
import { authenticate, attachOrgContext } from "../middleware/auth";
import { getSummary, getCoverageMetrics, triggerSync, getOperational, getPerformance, getAggregate, getOrgDashboardEndpoint } from "../controllers/dashboard.controller";

const router = Router();

router.get("/summary", authenticate, attachOrgContext, getSummary);
router.get("/coverage", authenticate, getCoverageMetrics);
router.get("/operational", authenticate, attachOrgContext, getOperational);
router.get("/performance", authenticate, attachOrgContext, getPerformance);
router.get("/aggregate", authenticate, getAggregate);
router.get("/org", authenticate, attachOrgContext, getOrgDashboardEndpoint);
router.post("/sync", authenticate, triggerSync);

export default router;
