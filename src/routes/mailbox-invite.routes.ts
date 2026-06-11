import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { createInvite, listInvites, revokeInvite } from "../controllers/mailbox-invite.controller";

const router = Router({ mergeParams: true });

router.post("/", authenticate, createInvite);
router.get("/", authenticate, listInvites);
router.delete("/:inviteId", authenticate, revokeInvite);

export default router;
