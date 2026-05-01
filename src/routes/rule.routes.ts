import { Router } from "express";
import { authenticate, attachOrgContext } from "../middleware/auth";
import { listRules, createRule } from "../controllers/rule.controller";

const router = Router();

router.get("/rules", authenticate, attachOrgContext, listRules);
router.post("/rules", authenticate, attachOrgContext, createRule);

export default router;
