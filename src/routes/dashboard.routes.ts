import { Router } from "express";
import { authenticate, attachOrgContext } from "../middleware/auth";
import { getSummary } from "../controllers/dashboard.controller";

const router = Router();

router.use(authenticate, attachOrgContext);

router.get("/summary", getSummary);

export default router;
