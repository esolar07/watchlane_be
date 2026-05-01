import { prisma } from "../lib/prisma";
import { syncFolderTree, FolderFetcher } from "../services/folder-sync.service";
import { fetchFolderDelta } from "../lib/microsoft-graph";
import { getValidAccessToken } from "../lib/microsoft";

interface MigrationDeps {
  accessTokenFor: (emailAccountId: string) => Promise<string>;
  fetcher: FolderFetcher;
}

export async function migrateExistingFolders(deps: MigrationDeps): Promise<void> {
  const accounts = await prisma.emailAccount.findMany({
    where: { provider: "MICROSOFT" },
    select: { id: true, emailAddress: true },
  });
  for (const account of accounts) await migrateOneAccountSafely(account, deps);
}

async function migrateOneAccountSafely(
  account: { id: string; emailAddress: string },
  deps: MigrationDeps
): Promise<void> {
  try {
    await migrateOneAccount(account.id, deps);
    console.log(`[migrate-folders] Migrated ${account.emailAddress}`);
  } catch (err) {
    console.error(`[migrate-folders] Failed for ${account.emailAddress}:`, err);
  }
}

async function migrateOneAccount(emailAccountId: string, deps: MigrationDeps): Promise<void> {
  const existingCount = await prisma.emailFolder.count({ where: { emailAccountId } });
  if (existingCount > 0) return;
  const accessToken = await deps.accessTokenFor(emailAccountId);
  await syncFolderTree(emailAccountId, accessToken, deps.fetcher);
}

export async function runMigrationCli(): Promise<void> {
  await migrateExistingFolders({
    accessTokenFor: getValidAccessToken,
    fetcher: fetchFolderDelta,
  });
}
