import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { getMe, updateMe } from "../controllers/me.controller";

const router = Router();

router.get("/me", authenticate, getMe);
router.patch("/me", authenticate, updateMe);

export default router;
