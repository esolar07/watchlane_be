import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { listOrganizations, createOrganization, getOrganization, updateOrganization } from "../controllers/organization.controller";

const router = Router();

router.get("/", authenticate, listOrganizations);
router.post("/", authenticate, createOrganization);
router.get("/:id", authenticate, getOrganization);
router.put("/:id", authenticate, updateOrganization);

export default router;
