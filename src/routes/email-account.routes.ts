import { Router } from "express";
import { authenticate, attachTeamContext } from "../middleware/auth";
import { listEmailAccounts, getEmailAccount } from "../controllers/email-account.controller";

const router = Router();

router.get("/email-accounts", authenticate, attachTeamContext, listEmailAccounts);
router.get("/email-accounts/:accountId", authenticate, attachTeamContext, getEmailAccount);

export default router;
