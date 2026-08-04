import { useCallback, useEffect, useState } from "react";
import { apiFetch, hasStoredAuthToken, notifyStoreChange } from "./api";
import { dbGet, dbSet, dbClear, STORES } from "./db";
import type {
  AuditEvent,
  Binder,
  BinderAttachment,
  BinderDocument,
  BinderNotifications,
  BinderSigner,
  BinderStatus,
  Contact,
  SignatureField,
} from "./types";

/**
 * Gardés uniquement pour la compatibilité avec la déconnexion
 * (clearCachedCollections dans auth.ts supprime ces clés localStorage).
 * Les binders sont désormais dans IndexedDB, mais on garde ces clés
 * pour nettoyer les éventuelles données résiduelles lors de la déconnexion.
 */
export const BINDER_CACHE_KEY = "usign.binders.cache";
export const CONTACT_CACHE_KEY = "usign.contacts.cache";

const BINDER_EVENT = "binders";
const CONTACT_EVENT = "contacts";

const DB_KEY_BINDERS = "binders";
const DB_KEY_INBOX = "inbox";
const DB_KEY_PARTICIPATED = "participated";
const DB_KEY_CC = "cc";
const DB_KEY_CONTACTS = "contacts";

function clearLegacyBinderLocalStorage() {
  if (typeof window === "undefined") return;

  try {
    // Older Usign builds stored complete PDFs and signature images here.
    // Removing this legacy cache both frees the browser quota and prevents an
    // old cache write from turning a successful API signature into a UI error.
    localStorage.removeItem(BINDER_CACHE_KEY);
  } catch {
    // Storage may be disabled by the browser; the server remains authoritative.
  }
}

clearLegacyBinderLocalStorage();

/**
 * Migration localStorage -> IndexedDB :
 * Les binders sont stockés dans IndexedDB (pas de limite de 5 MB).
 * Les contacts et la session restent en localStorage (petites donnees).
 */

type CreateBinderInput = {
  name: string;
  description?: string;
  group?: string;
  status?: BinderStatus;
  documents?: (BinderDocument & { content?: string })[];
  attachments?: BinderAttachment[];
  signers?: BinderSigner[];
  ccRecipients?: { email: string; name?: string }[];
  signatureFields?: SignatureField[];
  notifications?: BinderNotifications;
  consolidation?: boolean;
};

type UpdateBinderInput = Partial<Omit<Binder, "ccRecipients">> & {
  ccRecipients?: { id?: string; email: string; name?: string }[];
};

type SignPayload = {
  method: BinderSigner["signatureMethod"];
  signatureData: string;
  fieldOverrides?: Record<
    string,
    { method: BinderSigner["signatureMethod"]; signatureData: string }
  >;
};

export type BinderInvitation = {
  binderId: string;
  signerId: string;
  binderName: string;
  signerName: string;
  signerEmail: string;
  requesterName: string;
  requesterEmail: string;
  hasAccount: boolean;
  status: BinderSigner["status"];
  signPath: string;
};

type PaginatedResponse<T> = {
  items: T[];
  nextCursor?: string;
};

type CachedBinder = Partial<Binder> & Pick<Binder, "id" | "name" | "status" | "createdAt">;

export type DocumentRecord = {
  key: string;
  binder: Binder;
  documentId: string;
  binderId: string;
  name: string;
  binderName: string;
  binderDescription?: string;
  ownerName: string;
  ownerEmail: string;
  updatedAt: string;
  pages?: number;
  isOwned: boolean;
  signerOutcome?: "signed" | "declined";
};

// ── Fonctions localStorage (gardées pour contacts et compatibilité) ──

function readCache<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeCache<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Cache persistence must never make a successful server mutation fail.
    localStorage.removeItem(key);
  }
}

function clearCache(key: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(key);
}

// ── Fonctions IndexedDB (pour les binders, grosses données) ──

async function dbReadBinderCache(dbKey: string): Promise<Binder[]> {
  const data = await dbGet<unknown[]>(STORES.BINDERS as never, dbKey, []);
  return data.filter(isCachedBinder).map(normalizeBinderRecord);
}

async function dbWriteBinderCache(dbKey: string, binders: Binder[]) {
  await dbSet(STORES.BINDERS as never, dbKey, binders);
}

async function dbClearStore(storeName: string) {
  await dbClear(storeName as never);
}

// ── Fonctions partagées ──

function isCachedBinder(value: unknown): value is CachedBinder {
  if (!value || typeof value !== "object") {
    return false;
  }

  const binder = value as Partial<Binder>;
  return (
    typeof binder.id === "string" &&
    typeof binder.name === "string" &&
    typeof binder.status === "string" &&
    typeof binder.createdAt === "string"
  );
}

function normalizeBinderRecord<T extends CachedBinder>(binder: T): Binder {
  return {
    ...binder,
    updatedAt:
      typeof binder.updatedAt === "string" && binder.updatedAt.trim()
        ? binder.updatedAt
        : binder.createdAt,
  } as Binder;
}

function getBinderSortKey(binder: Pick<Partial<Binder>, "updatedAt" | "createdAt">) {
  if (typeof binder.updatedAt === "string" && binder.updatedAt.trim()) {
    return binder.updatedAt;
  }

  if (typeof binder.createdAt === "string" && binder.createdAt.trim()) {
    return binder.createdAt;
  }

  return "";
}

function sortBinders<T extends Pick<Partial<Binder>, "updatedAt" | "createdAt">>(items: T[]) {
  return [...items].sort((left, right) =>
    getBinderSortKey(right).localeCompare(getBinderSortKey(left)),
  );
}

function unwrapPageItems<T>(payload: T[] | PaginatedResponse<T>): T[] {
  return Array.isArray(payload) ? payload : payload.items;
}

function sortContacts(items: Contact[]) {
  return [...items].sort((left, right) => {
    const leftName = `${left.firstName} ${left.lastName}`.trim().toLowerCase();
    const rightName = `${right.firstName} ${right.lastName}`.trim().toLowerCase();
    return leftName.localeCompare(rightName);
  });
}

async function replaceBinderCache(nextBinder: Binder) {
  // Lire depuis IndexedDB
  const current = await dbReadBinderCache(DB_KEY_BINDERS);
  const safeNextBinder = normalizeBinderRecord(nextBinder);
  const next = sortBinders([
    safeNextBinder,
    ...current.filter((binder) => binder.id !== safeNextBinder.id),
  ]);
  await dbWriteBinderCache(DB_KEY_BINDERS, next);
  return next;
}

async function removeBinderFromCache(id: string) {
  const current = await dbReadBinderCache(DB_KEY_BINDERS);
  const next = current.filter((binder) => binder.id !== id);
  await dbWriteBinderCache(DB_KEY_BINDERS, next);
  return next;
}

function replaceContactsCache(nextContact: Contact) {
  const current = readCache<Contact[]>(CONTACT_CACHE_KEY, []);
  const next = sortContacts([
    nextContact,
    ...current.filter((contact) => contact.id !== nextContact.id),
  ]);
  writeCache(CONTACT_CACHE_KEY, next);
  return next;
}

function removeContactFromCache(id: string) {
  const next = readCache<Contact[]>(CONTACT_CACHE_KEY, []).filter((contact) => contact.id !== id);
  writeCache(CONTACT_CACHE_KEY, next);
  return next;
}

async function fetchBinders() {
  if (!hasStoredAuthToken()) {
    await dbClearStore(STORES.BINDERS);
    await dbClearStore(STORES.INBOX_BINDERS);
    await dbClearStore(STORES.PARTICIPATED_BINDERS);
    return [] as Binder[];
  }

  const payload = await apiFetch<Binder[] | PaginatedResponse<Binder>>("/binders?limit=100");
  const binders = unwrapPageItems(payload);
  const next = sortBinders(binders.map(normalizeBinderRecord));
  await dbWriteBinderCache(DB_KEY_BINDERS, next);
  return next;
}

async function fetchScopedBinders(path: string, dbKey: string) {
  if (!hasStoredAuthToken()) {
    await dbWriteBinderCache(dbKey, []);
    return [] as Binder[];
  }

  const separator = path.includes("?") ? "&" : "?";
  const payload = await apiFetch<Binder[] | PaginatedResponse<Binder>>(
    `${path}${separator}limit=100`,
  );
  const binders = unwrapPageItems(payload);
  const next = sortBinders(binders.map(normalizeBinderRecord));
  await dbWriteBinderCache(dbKey, next);
  return next;
}

async function fetchBinderDetail(id: string) {
  const binder = await apiFetch<Binder>(`/binders/${id}`);
  await replaceBinderCache(binder);
  return normalizeBinderRecord(binder);
}

async function fetchDocumentRecords(query?: string) {
  const params = new URLSearchParams({ limit: "100" });
  if (query?.trim()) {
    params.set("query", query.trim());
  }
  const payload = await apiFetch<DocumentRecord[] | PaginatedResponse<DocumentRecord>>(
    `/documents?${params.toString()}`,
  );
  return unwrapPageItems(payload);
}

async function fetchContacts() {
  if (!hasStoredAuthToken()) {
    clearCache(CONTACT_CACHE_KEY);
    return [] as Contact[];
  }

  const contacts = await apiFetch<Contact[]>("/contacts");
  const next = sortContacts(contacts);
  writeCache(CONTACT_CACHE_KEY, next);
  return next;
}

function emitStore(detail: string) {
  notifyStoreChange(detail);
}

export async function getPublicBinder(binderId: string, signerId: string, token: string) {
  return apiFetch<Binder>(
    `/public/binders/${binderId}/signers/${signerId}?token=${encodeURIComponent(token)}`,
    {
      skipAuth: true,
    },
  );
}

export async function getSignerInvitation(binderId: string, signerId: string, token: string) {
  return apiFetch<BinderInvitation>(
    `/public/binders/${binderId}/signers/${signerId}/invitation?token=${encodeURIComponent(token)}`,
    {
      skipAuth: true,
    },
  );
}

async function mutatePublicBinder(path: string, body?: Record<string, unknown>) {
  const binder = await apiFetch<Binder>(path, {
    method: "POST",
    skipAuth: true,
    body: JSON.stringify(body ?? {}),
  });

  if (hasStoredAuthToken()) {
    try {
      await replaceBinderCache(binder);
    } catch {
      // The API mutation already succeeded. A local cache failure is harmless.
    }
    emitStore(BINDER_EVENT);
  }

  return binder;
}

export async function markPublicSignerViewed(binderId: string, signerId: string, token: string) {
  return mutatePublicBinder(
    `/public/binders/${binderId}/signers/${signerId}/view?token=${encodeURIComponent(token)}`,
  );
}

export async function declinePublicSigner(
  binderId: string,
  signerId: string,
  token: string,
  reason: string,
) {
  return mutatePublicBinder(
    `/public/binders/${binderId}/signers/${signerId}/decline?token=${encodeURIComponent(token)}`,
    { reason },
  );
}

export async function signPublicSigner(
  binderId: string,
  signerId: string,
  token: string,
  payload: SignPayload,
) {
  return mutatePublicBinder(
    `/public/binders/${binderId}/signers/${signerId}/sign?token=${encodeURIComponent(token)}`,
    payload,
  );
}

async function createBinderRequest(data: CreateBinderInput) {
  const binder = await apiFetch<Binder>("/binders", {
    method: "POST",
    body: JSON.stringify({
      name: data.name,
      description: data.description,
      group: data.group,
      status: data.status,
      documents: data.documents,
      attachments: data.attachments,
      signers: data.signers,
      ccRecipients: data.ccRecipients,
      signatureFields: data.signatureFields,
      notifications: data.notifications,
      consolidation: data.consolidation,
    }),
  });

  await replaceBinderCache(binder);
  emitStore(BINDER_EVENT);
  return binder;
}

async function updateBinderRequest(id: string, patch: UpdateBinderInput) {
  const binder = await apiFetch<Binder>(`/binders/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

  await replaceBinderCache(binder);
  emitStore(BINDER_EVENT);
  return binder;
}

async function removeBinderRequest(id: string) {
  await apiFetch<{ ok: boolean }>(`/binders/${id}`, { method: "DELETE" });
  await removeBinderFromCache(id);
  emitStore(BINDER_EVENT);
}

async function startBinderRequest(binderId: string) {
  const binder = await apiFetch<Binder>(`/binders/${binderId}/start`, {
    method: "POST",
    body: JSON.stringify({}),
  });

  await replaceBinderCache(binder);
  emitStore(BINDER_EVENT);
  return binder;
}

async function markSignerViewedRequest(binderId: string, signerId: string) {
  const binder = await apiFetch<Binder>(`/binders/${binderId}/signers/${signerId}/view`, {
    method: "POST",
    body: JSON.stringify({}),
  });

  await replaceBinderCache(binder);
  emitStore(BINDER_EVENT);
  return binder;
}

async function declineAsRequest(binderId: string, signerId: string, reason: string) {
  const binder = await apiFetch<Binder>(`/binders/${binderId}/signers/${signerId}/decline`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });

  await replaceBinderCache(binder);
  emitStore(BINDER_EVENT);
  return binder;
}

async function remindSignerRequest(binderId: string, signerId: string) {
  const binder = await apiFetch<Binder>(`/binders/${binderId}/signers/${signerId}/remind`, {
    method: "POST",
    body: JSON.stringify({}),
  });

  await replaceBinderCache(binder);
  emitStore(BINDER_EVENT);
  return binder;
}

async function remindBinderRequest(binderId: string) {
  const binder = await apiFetch<Binder>(`/binders/${binderId}/remind`, {
    method: "POST",
    body: JSON.stringify({}),
  });

  await replaceBinderCache(binder);
  emitStore(BINDER_EVENT);
  return binder;
}

async function updateSignerInvitationEmailRequest(
  binderId: string,
  signerId: string,
  email: string,
) {
  const binder = await apiFetch<Binder>(`/binders/${binderId}/signers/${signerId}/invitation`, {
    method: "PATCH",
    body: JSON.stringify({ email }),
  });

  await replaceBinderCache(binder);
  emitStore(BINDER_EVENT);
  return binder;
}

async function signAsRequest(binderId: string, signerId: string, payload: SignPayload) {
  const binder = await apiFetch<Binder>(`/binders/${binderId}/signers/${signerId}/sign`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  emitStore(BINDER_EVENT);
  void replaceBinderCache(binder).catch(() => undefined);
  return binder;
}

async function recordDownloadRequest(binderId: string, what: "signed_pdf" | "certificate") {
  const binder = await apiFetch<Binder>(`/binders/${binderId}/downloads`, {
    method: "POST",
    body: JSON.stringify({ what }),
  });

  await replaceBinderCache(binder);
  emitStore(BINDER_EVENT);
  return binder;
}

export function useBinderActions() {
  return {
    create: useCallback(createBinderRequest, []),
    remove: useCallback(removeBinderRequest, []),
    update: useCallback(updateBinderRequest, []),
    signAs: useCallback(signAsRequest, []),
    startBinder: useCallback(startBinderRequest, []),
    markSignerViewed: useCallback(markSignerViewedRequest, []),
    declineAs: useCallback(declineAsRequest, []),
    remindSigner: useCallback(
      async (binderId: string, signerId: string, _actor?: { name: string; email: string }) =>
        remindSignerRequest(binderId, signerId),
      [],
    ),
    remindBinder: useCallback(remindBinderRequest, []),
    updateSignerInvitationEmail: useCallback(updateSignerInvitationEmailRequest, []),
    recordDownload: useCallback(
      async (
        binderId: string,
        _actor: { name?: string; email?: string },
        what: "signed_pdf" | "certificate",
      ) => recordDownloadRequest(binderId, what),
      [],
    ),
  };
}

export function useBinders() {
  const [binders, setBinders] = useState<Binder[]>([]);

  useEffect(() => {
    let active = true;

    if (hasStoredAuthToken()) {
      // Charger depuis IndexedDB (asynchrone)
      void dbReadBinderCache(DB_KEY_BINDERS).then((cached) => {
        if (active && cached.length) setBinders(cached);
      });
    }

    const sync = async () => {
      try {
        const next = await fetchBinders();
        if (active) {
          setBinders(next);
        }
      } catch {
        if (!active) return;
        if (!hasStoredAuthToken()) {
          setBinders([]);
        }
      }
    };

    void sync();

    const onStoreChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === BINDER_EVENT) {
        void sync();
      }
    };

    const onAuthChange = () => {
      if (!hasStoredAuthToken()) {
        setBinders([]);
        void dbClearStore(STORES.CC_BINDERS);
        void dbClearStore(STORES.BINDERS);
        void dbClearStore(STORES.INBOX_BINDERS);
        void dbClearStore(STORES.PARTICIPATED_BINDERS);
        return;
      }

      void sync();
    };

    window.addEventListener("goodflag:store", onStoreChange);
    window.addEventListener("goodflag:auth", onAuthChange);

    return () => {
      active = false;
      window.removeEventListener("goodflag:store", onStoreChange);
      window.removeEventListener("goodflag:auth", onAuthChange);
    };
  }, []);

  const create = useCallback(async (data: CreateBinderInput) => {
    const binder = await apiFetch<Binder>("/binders", {
      method: "POST",
      body: JSON.stringify({
        name: data.name,
        description: data.description,
        group: data.group,
        status: data.status,
        documents: data.documents,
        attachments: data.attachments,
        signers: data.signers,
        ccRecipients: data.ccRecipients,
        signatureFields: data.signatureFields,
        notifications: data.notifications,
        consolidation: data.consolidation,
      }),
    });

    const next = await replaceBinderCache(binder);
    setBinders(next);
    emitStore(BINDER_EVENT);
    return binder;
  }, []);

  const remove = useCallback(async (id: string) => {
    await apiFetch<{ ok: boolean }>(`/binders/${id}`, { method: "DELETE" });
    const next = await removeBinderFromCache(id);
    setBinders(next);
    emitStore(BINDER_EVENT);
  }, []);

  const update = useCallback(async (id: string, patch: UpdateBinderInput) => {
    const binder = await apiFetch<Binder>(`/binders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });

    const next = await replaceBinderCache(binder);
    setBinders(next);
    emitStore(BINDER_EVENT);
    return binder;
  }, []);

  const appendEvent = useCallback(
    async (_binderId: string, _event: Omit<AuditEvent, "id" | "at"> & { at?: string }) => {},
    [],
  );

  const startBinder = useCallback(async (binderId: string) => {
    const binder = await apiFetch<Binder>(`/binders/${binderId}/start`, {
      method: "POST",
      body: JSON.stringify({}),
    });

    const next = await replaceBinderCache(binder);
    setBinders(next);
    emitStore(BINDER_EVENT);
    return binder;
  }, []);

  const markSignerViewed = useCallback(async (binderId: string, signerId: string) => {
    const binder = await apiFetch<Binder>(`/binders/${binderId}/signers/${signerId}/view`, {
      method: "POST",
      body: JSON.stringify({}),
    });

    const next = await replaceBinderCache(binder);
    setBinders(next);
    emitStore(BINDER_EVENT);

    return binder;
  }, []);

  const declineAs = useCallback(async (binderId: string, signerId: string, reason: string) => {
    const binder = await apiFetch<Binder>(`/binders/${binderId}/signers/${signerId}/decline`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });

    const next = await replaceBinderCache(binder);
    setBinders(next);
    emitStore(BINDER_EVENT);

    return binder;
  }, []);

  const remindSigner = useCallback(
    async (binderId: string, signerId: string, _actor: { name: string; email: string }) => {
      const binder = await apiFetch<Binder>(`/binders/${binderId}/signers/${signerId}/remind`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      const next = await replaceBinderCache(binder);
      setBinders(next);
      emitStore(BINDER_EVENT);
      return binder;
    },
    [],
  );

  const remindBinder = useCallback(async (binderId: string) => {
    const binder = await apiFetch<Binder>(`/binders/${binderId}/remind`, {
      method: "POST",
      body: JSON.stringify({}),
    });

    const next = await replaceBinderCache(binder);
    setBinders(next);
    emitStore(BINDER_EVENT);
    return binder;
  }, []);

  const updateSignerInvitationEmail = useCallback(
    async (binderId: string, signerId: string, email: string) => {
      const binder = await apiFetch<Binder>(`/binders/${binderId}/signers/${signerId}/invitation`, {
        method: "PATCH",
        body: JSON.stringify({ email }),
      });

      const next = await replaceBinderCache(binder);
      setBinders(next);
      emitStore(BINDER_EVENT);
      return binder;
    },
    [],
  );

  const signAs = useCallback(async (binderId: string, signerId: string, payload: SignPayload) => {
    const binder = await apiFetch<Binder>(`/binders/${binderId}/signers/${signerId}/sign`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    setBinders((current) =>
      sortBinders([binder, ...current.filter((item) => item.id !== binder.id)]),
    );
    emitStore(BINDER_EVENT);

    // Persist opportunistically. The server response, not the browser cache,
    // determines whether the signature succeeded.
    void replaceBinderCache(binder).catch(() => undefined);

    return binder;
  }, []);

  const recordDownload = useCallback(
    async (
      binderId: string,
      _actor: { name?: string; email?: string },
      what: "signed_pdf" | "certificate",
    ) => {
      const binder = await apiFetch<Binder>(`/binders/${binderId}/downloads`, {
        method: "POST",
        body: JSON.stringify({ what }),
      });

      const next = await replaceBinderCache(binder);
      setBinders(next);
      emitStore(BINDER_EVENT);
      return binder;
    },
    [],
  );

  return {
    binders,
    create,
    remove,
    update,
    signAs,
    startBinder,
    markSignerViewed,
    declineAs,
    remindSigner,
    remindBinder,
    updateSignerInvitationEmail,
    appendEvent,
    recordDownload,
  };
}

function useBinderCollection(path: string, dbKey: string) {
  const [binders, setBinders] = useState<Binder[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    if (hasStoredAuthToken()) {
      void dbReadBinderCache(dbKey).then((cached) => {
        if (active && cached.length) setBinders(cached);
      });
    }

    const sync = async () => {
      setIsLoading(true);
      try {
        const next = await fetchScopedBinders(path, dbKey);
        if (active) {
          setBinders(next);
        }
      } catch {
        if (!active) return;
        if (!hasStoredAuthToken()) {
          setBinders([]);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void sync();

    const onStoreChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === BINDER_EVENT) {
        void sync();
      }
    };

    const onAuthChange = () => {
      if (!hasStoredAuthToken()) {
        setBinders([]);
        void dbWriteBinderCache(dbKey, []);
        setIsLoading(false);
        return;
      }

      void sync();
    };

    window.addEventListener("goodflag:store", onStoreChange);
    window.addEventListener("goodflag:auth", onAuthChange);

    return () => {
      active = false;
      window.removeEventListener("goodflag:store", onStoreChange);
      window.removeEventListener("goodflag:auth", onAuthChange);
    };
  }, [dbKey, path]);

  return { binders, isLoading };
}

export function useBinderDetail(id: string) {
  const [binder, setBinder] = useState<Binder | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await fetchBinderDetail(id);
    setBinder(next);
    return next;
  }, [id]);

  useEffect(() => {
    let active = true;

    if (hasStoredAuthToken()) {
      void Promise.all([
        dbReadBinderCache(DB_KEY_BINDERS),
        dbReadBinderCache(DB_KEY_CC),
        dbReadBinderCache(DB_KEY_INBOX),
        dbReadBinderCache(DB_KEY_PARTICIPATED),
      ]).then((collections) => {
        if (!active) return;
        const cached = collections.flat().find((item) => item.id === id);
        if (cached) {
          setBinder(cached);
        }
      });
    }

    const sync = async () => {
      setIsLoading(true);
      try {
        const next = await fetchBinderDetail(id);
        if (active) {
          setBinder(next);
        }
      } catch {
        if (active) {
          setBinder(null);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void sync();

    const onStoreChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === BINDER_EVENT) {
        void sync();
      }
    };
    const onAuthChange = () => {
      void sync();
    };

    window.addEventListener("goodflag:store", onStoreChange);
    window.addEventListener("goodflag:auth", onAuthChange);

    return () => {
      active = false;
      window.removeEventListener("goodflag:store", onStoreChange);
      window.removeEventListener("goodflag:auth", onAuthChange);
    };
  }, [id]);

  return { binder, isLoading, refresh };
}

export function useInboxBinders() {
  return useBinderCollection("/binders/inbox", DB_KEY_INBOX);
}

export function useParticipatedBinders() {
  return useBinderCollection("/binders/participated", DB_KEY_PARTICIPATED);
}

export function useCcBinders() {
  return useBinderCollection("/binders/cc", DB_KEY_CC);
}

export function useDocumentRecords(query?: string) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const sync = async () => {
      setIsLoading(true);
      try {
        const next = await fetchDocumentRecords(query);
        if (active) {
          setDocuments(next);
        }
      } catch {
        if (active) {
          setDocuments([]);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void sync();

    const onStoreChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === BINDER_EVENT) {
        void sync();
      }
    };
    const onAuthChange = () => {
      void sync();
    };

    window.addEventListener("goodflag:store", onStoreChange);
    window.addEventListener("goodflag:auth", onAuthChange);

    return () => {
      active = false;
      window.removeEventListener("goodflag:store", onStoreChange);
      window.removeEventListener("goodflag:auth", onAuthChange);
    };
  }, [query]);

  return { documents, isLoading };
}

export function usePublicBinder(binderId: string, signerId: string, token: string) {
  const [binder, setBinder] = useState<Binder | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await getPublicBinder(binderId, signerId, token);
    setBinder(next);
    return next;
  }, [binderId, signerId, token]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setIsLoading(true);
      try {
        const next = await getPublicBinder(binderId, signerId, token);
        if (active) {
          setBinder(next);
        }
      } catch {
        if (active) {
          setBinder(null);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [binderId, signerId, token]);

  return { binder, isLoading, refresh };
}

export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    let active = true;

    if (hasStoredAuthToken()) {
      const cached = readCache<Contact[]>(CONTACT_CACHE_KEY, []);
      if (cached.length) setContacts(cached);
    }

    const sync = async () => {
      try {
        const next = await fetchContacts();
        if (active) {
          setContacts(next);
        }
      } catch {
        if (!active) return;
        if (!hasStoredAuthToken()) {
          setContacts([]);
        }
      }
    };

    void sync();

    const onStoreChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === CONTACT_EVENT) {
        void sync();
      }
    };

    const onAuthChange = () => {
      if (!hasStoredAuthToken()) {
        setContacts([]);
        clearCache(CONTACT_CACHE_KEY);
        return;
      }

      void sync();
    };

    window.addEventListener("goodflag:store", onStoreChange);
    window.addEventListener("goodflag:auth", onAuthChange);

    return () => {
      active = false;
      window.removeEventListener("goodflag:store", onStoreChange);
      window.removeEventListener("goodflag:auth", onAuthChange);
    };
  }, []);

  const create = useCallback(async (contact: Omit<Contact, "id">) => {
    const nextContact = await apiFetch<Contact>("/contacts", {
      method: "POST",
      body: JSON.stringify(contact),
    });

    const next = replaceContactsCache(nextContact);
    setContacts(next);
    emitStore(CONTACT_EVENT);
    return nextContact;
  }, []);

  const remove = useCallback(async (id: string) => {
    await apiFetch<{ ok: boolean }>(`/contacts/${id}`, { method: "DELETE" });
    const next = removeContactFromCache(id);
    setContacts(next);
    emitStore(CONTACT_EVENT);
  }, []);

  return { contacts, create, remove };
}
