import { Router } from "express";
import { authenticate, attachTeamContext } from "../middleware/auth";
import { listRules, createRule } from "../controllers/rule.controller";

const router = Router();

router.get("/rules", authenticate, attachTeamContext, listRules);
router.post("/rules", authenticate, attachTeamContext, createRule);

export default router;
