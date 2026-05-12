import { Router } from "express";
import { authenticate, attachWorkspaceContext } from "../middleware/auth";
import {
  listMyWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  listWorkspaceMembers,
  addWorkspaceMember,
  updateWorkspaceMember,
  removeWorkspaceMember,
} from "../controllers/workspace.controller";

const router = Router();

router.get("/workspaces", authenticate, listMyWorkspaces);
router.post("/workspaces", authenticate, createWorkspace);
router.get("/workspaces/current", authenticate, attachWorkspaceContext, getWorkspace);
router.patch("/workspaces/current", authenticate, attachWorkspaceContext, updateWorkspace);
router.get("/workspaces/current/members", authenticate, attachWorkspaceContext, listWorkspaceMembers);
router.post("/workspaces/current/members", authenticate, attachWorkspaceContext, addWorkspaceMember);
router.patch("/workspaces/current/members/:memberId", authenticate, attachWorkspaceContext, updateWorkspaceMember);
router.delete("/workspaces/current/members/:memberId", authenticate, attachWorkspaceContext, removeWorkspaceMember);

export default router;
