import { Router } from "express";
import { authenticate, attachOrgContext } from "../middleware/auth";
import { listEmailAccounts, getEmailAccount } from "../controllers/email-account.controller";

const router = Router();

router.get("/email-accounts", authenticate, attachOrgContext, listEmailAccounts);
router.get("/email-accounts/:accountId", authenticate, getEmailAccount);

export default router;
