import { Router } from "express";
import { authenticate, attachTeamContext } from "../middleware/auth";
import { getSummary, getCoverageMetrics, triggerSync, getOperational, getPerformance, getAggregate, getOrgDashboardEndpoint } from "../controllers/dashboard.controller";

const router = Router();

router.get("/summary", authenticate, attachTeamContext, getSummary);
router.get("/coverage", authenticate, getCoverageMetrics);
router.get("/operational", authenticate, attachTeamContext, getOperational);
router.get("/performance", authenticate, attachTeamContext, getPerformance);
router.get("/aggregate", authenticate, getAggregate);
router.get("/org", authenticate, attachTeamContext, getOrgDashboardEndpoint);
router.post("/sync", authenticate, triggerSync);

export default router;
