const SHARED_MAILBOX_LABEL = "Shared mailbox";

export function resolveMailboxOwnerName(user: { name: string | null } | null | undefined): string {
  return user?.name ?? SHARED_MAILBOX_LABEL;
}
