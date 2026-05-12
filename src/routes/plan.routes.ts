import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireSuperAdmin } from "../middleware/entitlements";
import { listPublicPlans, listAdminPlans, createPlan, updatePlan, deletePlan, upsertPlanFeatures, createPlanPrice, updatePlanPrice, deletePlanPrice } from "../controllers/plan.controller";

const router = Router();

router.get("/plans", listPublicPlans);

const admin = Router();
admin.use(authenticate, requireSuperAdmin);
admin.get("/plans", listAdminPlans);
admin.post("/plans", createPlan);
admin.patch("/plans/:id", updatePlan);
admin.delete("/plans/:id", deletePlan);
admin.put("/plans/:id/features", upsertPlanFeatures);
admin.post("/plans/:id/prices", createPlanPrice);
admin.patch("/plans/:id/prices/:priceId", updatePlanPrice);
admin.delete("/plans/:id/prices/:priceId", deletePlanPrice);
router.use("/admin", admin);

export default router;
