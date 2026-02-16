import { Router } from "express";
import { authenticate } from "../middleware/auth";
import {
  getAuthUrls,
  googleCallback,
  microsoftCallback,
  logout,
  me,
} from "../controllers/auth.controller";

const router = Router();

router.get("/urls", getAuthUrls);
router.get("/google/callback", googleCallback);
router.get("/microsoft/callback", microsoftCallback);
router.post("/logout", logout);
router.get("/me", authenticate, me);

export default router;
