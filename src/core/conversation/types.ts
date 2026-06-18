export type ConversationControlMode = "AI" | "HUMAN" | "PAUSED";
export type ConversationChannel = "WEB_WIDGET" | "WHATSAPP" | "ADMIN";
export type MessageRole = "TRAVELLER" | "ASSISTANT" | "OPERATOR" | "SYSTEM" | "TOOL";

export interface Conversation {
  id: string;
  tenantId: string;
  channel: ConversationChannel;
  controlMode: ConversationControlMode;
  travellerId: string | null;
  leadId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  tenantId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
}

export function canKaiReply(controlMode: ConversationControlMode) {
  return controlMode === "AI";
}
