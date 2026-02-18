export interface GraphEmailAddress {
  emailAddress: { address: string; name?: string };
}

export interface GraphMessage {
  id: string;
  conversationId: string;
  subject: string | null;
  from: GraphEmailAddress;
  toRecipients: GraphEmailAddress[];
  receivedDateTime: string;
  body: { contentType: string; content: string };
}

export interface GraphResponse {
  value: GraphMessage[];
  "@odata.nextLink"?: string;
}

export interface NormalizedMessage {
  messageId: string;
  conversationId: string;
  subject: string | null;
  from: string;
  to: string[];
  body: string;
  timestamp: Date;
  direction: "INBOUND" | "OUTBOUND";
}
