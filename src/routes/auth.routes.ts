import { Router } from "express";
import { authenticate, attachOrgContext, requireRole } from "../middleware/auth";
import {
  getAuthUrls,
  googleCallback,
  microsoftCallback,
  getInviteAuthUrl,
  getMailboxConnectUrl,
  logout,
  me,
  devSeed,
} from "../controllers/auth.controller";

const router = Router();

router.get("/urls", getAuthUrls);
router.get("/google/callback", googleCallback);
router.get("/microsoft/callback", microsoftCallback);
router.get("/microsoft/invite-url", getInviteAuthUrl);
router.post("/logout", logout);

router.get("/me", authenticate, me);

router.get(
  "/microsoft/connect-url",
  authenticate,
  attachOrgContext,
  requireRole("OWNER", "ADMIN"),
  getMailboxConnectUrl
);

if (process.env.NODE_ENV !== "production") {
  router.post("/dev-seed", devSeed);
}

export default router;
