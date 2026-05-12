import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { completeOnboarding } from "../controllers/onboarding.controller";

const router = Router();

router.post("/onboarding", authenticate, completeOnboarding);

export default router;
