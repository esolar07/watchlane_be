import { Router } from "express";
import { authenticate, attachOrgContext } from "../middleware/auth";
import { listFolders, setFolderMonitored } from "../controllers/folder.controller";

const router = Router();

router.get("/email-accounts/:accountId/folders", authenticate, attachOrgContext, listFolders);
router.patch("/folders/:folderId/monitored", authenticate, attachOrgContext, setFolderMonitored);

export default router;
