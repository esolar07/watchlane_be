import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { listOrganizations, createOrganization } from "../controllers/organization.controller";

const router = Router();

router.get("/", authenticate, listOrganizations);
router.post("/", authenticate, createOrganization);

export default router;
