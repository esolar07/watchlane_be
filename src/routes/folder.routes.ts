import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { listFolders, setFolderMonitored } from "../controllers/folder.controller";

const router = Router();

router.get("/email-accounts/:accountId/folders", authenticate, listFolders);
router.patch("/folders/:folderId/monitored", authenticate, setFolderMonitored);

export default router;
