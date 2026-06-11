import { Router } from "express";
import { getPublicInvite } from "../controllers/mailbox-invite.controller";

const router = Router();

router.get("/mailbox/:token", getPublicInvite);

export default router;
