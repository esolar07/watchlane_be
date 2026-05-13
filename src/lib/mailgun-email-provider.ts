import Mailgun from "mailgun.js";
import FormData from "form-data";
import {
  EmailMessage,
  EmailProvider,
  EmailRecipient,
  EmailSendResult,
} from "../types/email-provider";

function formatRecipient(recipient: EmailRecipient): string {
  if (!recipient.name) return recipient.address;
  return `${recipient.name} <${recipient.address}>`;
}

function buildMailgunPayload(message: EmailMessage) {
  const payload: Record<string, unknown> = {
    from: formatRecipient(message.from),
    to: message.to.map(formatRecipient),
    subject: message.subject,
  };
  if (message.text) payload.text = message.text;
  if (message.html) payload.html = message.html;
  return payload;
}

export class MailgunEmailProvider implements EmailProvider {
  private readonly client;
  private readonly domain: string;

  constructor(apiKey: string, domain: string, endpoint?: string) {
    const factory = new Mailgun(FormData);
    this.client = factory.client({ username: "api", key: apiKey, url: endpoint });
    this.domain = domain;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const payload = buildMailgunPayload(message) as any;
    const response = await this.client.messages.create(this.domain, payload);
    return { id: response.id ?? "", provider: "mailgun" };
  }
}
