import { Router } from "express";
import { authenticate, attachWorkspaceContext } from "../middleware/auth";
import { listTeams, createTeam, getTeam, updateTeam } from "../controllers/team.controller";
import { listTeamMembers, addTeamMember, updateTeamMember, removeTeamMember } from "../controllers/team-member.controller";
import mailboxInviteRoutes from "./mailbox-invite.routes";

const router = Router();

router.get("/", authenticate, listTeams);
router.post("/", authenticate, attachWorkspaceContext, createTeam);
router.get("/:id", authenticate, getTeam);
router.put("/:id", authenticate, updateTeam);

router.get("/:teamId/members", authenticate, listTeamMembers);
router.post("/:teamId/members", authenticate, addTeamMember);
router.patch("/:teamId/members/:memberId", authenticate, updateTeamMember);
router.delete("/:teamId/members/:memberId", authenticate, removeTeamMember);

router.use("/:teamId/mailbox-invites", mailboxInviteRoutes);

export default router;
