import { Router } from "express";
import { authenticate, attachWorkspaceContext } from "../middleware/auth";
import { listOrganizations, createOrganization, getOrganization, updateOrganization, regenerateInviteCode } from "../controllers/organization.controller";

const router = Router();

router.get("/", authenticate, listOrganizations);
router.post("/", authenticate, attachWorkspaceContext, createOrganization);
router.get("/:id", authenticate, getOrganization);
router.put("/:id", authenticate, updateOrganization);
router.post("/:id/regenerate-invite", authenticate, regenerateInviteCode);

export default router;
