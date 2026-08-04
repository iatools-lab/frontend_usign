export type BinderStatus = "draft" | "started" | "finished" | "stopped" | "archived";

export type BinderDocument = {
  id: string;
  name: string;
  size?: number;
  pages?: number;
  content?: string;
};

export type BinderAttachment = {
  id: string;
  name: string;
  size?: number;
  mimeType?: string;
  content?: string;
};

export type SignerStatus = "pending" | "signed" | "declined";
export type InvitationEmailStatus = "pending" | "sent" | "failed";

export type BinderSigner = {
  id: string;
  order: number;
  name: string;
  email: string;
  color?: string;
  status?: SignerStatus;
  signedAt?: string;
  signatureMethod?: "drawn" | "typed" | "image" | "otp";
  signatureData?: string;
  viewedAt?: string;
  declinedAt?: string;
  declinedReason?: string;
  ip?: string;
  inviteEmailStatus?: InvitationEmailStatus;
  inviteEmailSentAt?: string;
  inviteEmailError?: string;
};

export type AuditEventKind =
  | "binder.created"
  | "binder.started"
  | "binder.completed"
  | "binder.stopped"
  | "binder.archived"
  | "signer.invited"
  | "signer.viewed"
  | "signer.signed"
  | "signer.declined"
  | "signer.reminded"
  | "evidence.downloaded";

export type AuditEvent = {
  id: string;
  kind: AuditEventKind;
  at: string;
  actorName?: string;
  actorEmail?: string;
  targetName?: string;
  targetEmail?: string;
  ip?: string;
  message?: string;
};

export type SignatureFieldKind = "signature" | "initial";

export type SignatureField = {
  id: string;
  documentId: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  signerId: string;
  kind?: SignatureFieldKind;
  signedAt?: string;
  signatureData?: string;
};

export function getInitialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return parts
    .slice(0, 3)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export type BinderNotifications = {
  onStart: boolean;
  onComplete: boolean;
  reminders: boolean;
  reminderEveryHours?: number;
};

export type Binder = {
  id: string;
  name: string;
  description?: string;
  ownerName: string;
  ownerEmail: string;
  ownerInitials: string;
  isOwner: boolean;
  isCcRecipient: boolean;
  group: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  stoppedAt?: string;
  stoppedReason?: string;
  updatedAt: string;
  status: BinderStatus;
  progress: number;
  externalArchive?: string;
  consolidation: boolean;
  documents?: BinderDocument[];
  attachments?: BinderAttachment[];
  signers?: BinderSigner[];
  ccRecipients?: { id: string; email: string; name?: string }[];
  signatureFields?: SignatureField[];
  notifications?: BinderNotifications;
  auditEvents?: AuditEvent[];
};

export type Contact = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: string;
};

export const SIGNER_COLORS = [
  "#0EA5E9",
  "#F59E0B",
  "#10B981",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#14B8A6",
  "#F97316",
];
