import { Router } from "express";
import { authenticate, attachWorkspaceContext } from "../middleware/auth";
import { getMyEntitlements } from "../controllers/entitlements.controller";

const router = Router();

router.get("/entitlements", authenticate, attachWorkspaceContext, getMyEntitlements);

export default router;
