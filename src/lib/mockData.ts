export type BinderStatus = "draft" | "started" | "finished" | "stopped" | "archived";

export type BinderDocument = {
  id: string;
  name: string;
  size?: number;
  pages?: number; // mocked page count
  content?: string;
};

export type BinderAttachment = {
  id: string;
  name: string;
  size?: number;
};

export type SignerStatus = "pending" | "signed" | "declined";
export type InvitationEmailStatus = "pending" | "sent" | "failed";

export type BinderSigner = {
  id: string;
  order: number;
  name: string;
  email: string;
  color?: string; // assigned color for placement
  status?: SignerStatus;
  signedAt?: string;
  signatureMethod?: "drawn" | "typed" | "image" | "otp";
  signatureData?: string; // dataURL or typed name
  /** Dernière fois que le signataire a ouvert le lien de signature. */
  viewedAt?: string;
  /** Date de refus, si le signataire a refusé de signer. */
  declinedAt?: string;
  /** Motif du refus saisi par le signataire. */
  declinedReason?: string;
  /** IP simulée capturée lors de la signature/refus. */
  ip?: string;
  /** État de l'envoi du mail d'invitation initial. */
  inviteEmailStatus?: InvitationEmailStatus;
  /** Date d'envoi du mail d'invitation, lorsqu'il a abouti. */
  inviteEmailSentAt?: string;
  /** Dernière erreur d'envoi connue pour l'invitation initiale. */
  inviteEmailError?: string;
};

/** Catégories d'événements applicatifs visibles dans la timeline. */
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
  /** ISO timestamp */
  at: string;
  /** Acteur lisible (nom + email). */
  actorName?: string;
  actorEmail?: string;
  /** Cible (autre participant impacté). */
  targetName?: string;
  targetEmail?: string;
  /** IP simulée. */
  ip?: string;
  /** Texte libre additionnel (ex. motif de refus). */
  message?: string;
};

export type SignatureFieldKind = "signature" | "initial";

export type SignatureField = {
  id: string;
  documentId: string;
  page: number; // 1-based
  x: number; // 0..1 relative
  y: number; // 0..1 relative
  width: number; // 0..1 relative
  height: number; // 0..1 relative
  signerId: string;
  /** "signature" = full signature ; "initial" = paraphe (initiales auto). */
  kind?: SignatureFieldKind;
  signedAt?: string;
  signatureData?: string;
};

/** Returns initials (max 3 chars) from a full name, e.g. "Jeanne Marie Dupont" -> "JMD". */
export function getInitialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return parts
    .slice(0, 3)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Generate a deterministic-looking fake IPv4 (mock only). */
export function mockIp(): string {
  const r = () => Math.floor(Math.random() * 240) + 10;
  return `${r()}.${r()}.${r()}.${r()}`;
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
]