import { config } from "../config/env";
import { MailgunEmailProvider } from "../lib/mailgun-email-provider";
import { EmailMessage, EmailProvider, EmailSendResult } from "../types/email-provider";

let cachedProvider: EmailProvider | null = null;

function createEmailProvider(): EmailProvider {
  return new MailgunEmailProvider(
    config.mailgun.apiKey,
    config.mailgun.domain,
    config.mailgun.endpoint
  );
}

export function getEmailProvider(): EmailProvider {
  if (!cachedProvider) cachedProvider = createEmailProvider();
  return cachedProvider;
}

export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  return getEmailProvider().send(message);
}
