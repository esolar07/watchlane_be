import { prisma } from "../lib/prisma";
import { config } from "../config/env";
import { sendEmail } from "./email.service";
import { buildOwnerWelcomeEmail } from "../lib/email-templates/owner-welcome";
import { EmailRecipient } from "../types/email-provider";

function getDefaultSender(): EmailRecipient {
  return { name: config.email.fromName, address: config.email.fromAddress };
}

function resolveDisplayName(name: string | null, email: string): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : email.split("@")[0];
}

export async function sendOwnerWelcomeEmail(userId: string, workspaceName: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, name: true },
  });
  const ownerName = resolveDisplayName(user.name, user.email);
  const content = buildOwnerWelcomeEmail({ ownerName, workspaceName });
  const recipient: EmailRecipient = { name: user.name ?? undefined, address: user.email };
  await sendEmail({ from: getDefaultSender(), to: [recipient], ...content });
}
