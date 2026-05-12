import { Router } from "express";
import { authenticate, requireOnboardingComplete } from "../middleware/auth";
import authRoutes from "./auth.routes";
import dashboardRoutes from "./dashboard.routes";
import teamRoutes from "./team.routes";
import folderRoutes from "./folder.routes";
import ruleRoutes from "./rule.routes";
import emailAccountRoutes from "./email-account.routes";
import planRoutes from "./plan.routes";
import entitlementsRoutes from "./entitlements.routes";
import workspaceRoutes from "./workspace.routes";
import onboardingRoutes from "./onboarding.routes";
import meRoutes from "./me.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use(meRoutes);
router.use(onboardingRoutes);
router.use(planRoutes);

const gated = Router();
gated.use(authenticate, requireOnboardingComplete);
gated.use("/dashboard", dashboardRoutes);
gated.use("/teams", teamRoutes);
gated.use(emailAccountRoutes);
gated.use(folderRoutes);
gated.use(ruleRoutes);
gated.use(entitlementsRoutes);
gated.use(workspaceRoutes);
router.use(gated);

export default router;
