export const ALLOWED_SIGNER_EMAIL_DOMAINS = ["upowa.org", "edf.cm"] as const;

export function isAllowedSignerEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  return ALLOWED_SIGNER_EMAIL_DOMAINS.some((domain) => normalizedEmail.endsWith(`@${domain}`));
}
