import { Router } from "express";
import authRoutes from "./auth.routes";
import dashboardRoutes from "./dashboard.routes";
import organizationRoutes from "./organization.routes";
import folderRoutes from "./folder.routes";
import ruleRoutes from "./rule.routes";
import emailAccountRoutes from "./email-account.routes";
import planRoutes from "./plan.routes";
import entitlementsRoutes from "./entitlements.routes";
import workspaceRoutes from "./workspace.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/organizations", organizationRoutes);
router.use(emailAccountRoutes);
router.use(folderRoutes);
router.use(ruleRoutes);
router.use(planRoutes);
router.use(entitlementsRoutes);
router.use(workspaceRoutes);

export default router;
