export type EmailRecipient = {
  name?: string;
  address: string;
};

export type EmailMessage = {
  from: EmailRecipient;
  to: EmailRecipient[];
  subject: string;
  text?: string;
  html?: string;
};

export type EmailSendResult = {
  id: string;
  provider: string;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}
