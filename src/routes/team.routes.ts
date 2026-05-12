import { Router } from "express";
import { authenticate, attachWorkspaceContext } from "../middleware/auth";
import { listTeams, createTeam, getTeam, updateTeam, regenerateTeamInviteCode } from "../controllers/team.controller";

const router = Router();

router.get("/", authenticate, listTeams);
router.post("/", authenticate, attachWorkspaceContext, createTeam);
router.get("/:id", authenticate, getTeam);
router.put("/:id", authenticate, updateTeam);
router.post("/:id/regenerate-invite", authenticate, regenerateTeamInviteCode);

export default router;
