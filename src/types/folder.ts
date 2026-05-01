export interface GraphMailFolder {
  id: string;
  displayName: string;
  parentFolderId: string | null;
  totalItemCount?: number;
  unreadItemCount?: number;
  "@removed"?: { reason: string };
}
