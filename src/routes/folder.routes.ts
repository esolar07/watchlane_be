import { Router } from "express";
import { authenticate, attachTeamContext } from "../middleware/auth";
import { listFolders, setFolderMonitored } from "../controllers/folder.controller";

const router = Router();

router.get("/email-accounts/:accountId/folders", authenticate, attachTeamContext, listFolders);
router.patch("/folders/:folderId/monitored", authenticate, attachTeamContext, setFolderMonitored);

export default router;
