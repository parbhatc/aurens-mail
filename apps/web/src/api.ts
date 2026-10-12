import type { Folder, Mailbox, MessageDetail, MessageSummary, SessionUser, TempMailbox, TempMessageDetail, TempMessageSummary } from "./types";

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers,
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
  if (!response.ok) throw new ApiError(body.error?.code ?? "REQUEST_FAILED", body.error?.message ?? "The request failed.", response.status);
  return body as T;
}

export const api = {
  session: () => request<{ user: SessionUser }>("/api/session"),
  login: (email: string, password: string) => request<{ user: SessionUser }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  mailboxes: () => request<{ mailboxes: Mailbox[] }>("/api/mailboxes"),
  createMailbox: (address: string, displayName: string, isCatchAll: boolean) => request<{ mailbox: Mailbox }>("/api/mailboxes", { method: "POST", body: JSON.stringify({ address, displayName: displayName || undefined, isCatchAll }) }),
  deleteMailbox: (id: string) => request<void>(`/api/mailboxes/${id}`, { method: "DELETE" }),
  tempMailboxes: () => request<{ mailboxes: TempMailbox[] }>("/api/temp-mailboxes"),
  createTempMailbox: (localPart: string, ttlMinutes?: number) => request<{ mailbox: TempMailbox; accessToken: string }>("/api/temp-mailboxes", { method: "POST", body: JSON.stringify({ ...(localPart ? { localPart } : {}), ...(ttlMinutes ? { ttlMinutes } : {}) }) }),
  deleteTempMailbox: (id: string) => request<void>(`/api/temp-mailboxes/${id}`, { method: "DELETE" }),
  tempMessages: (id: string) => request<{ messages: TempMessageSummary[] }>(`/api/temp-mailboxes/${id}/messages`),
  tempMessage: (id: string, messageId: string) => request<{ message: TempMessageDetail }>(`/api/temp-mailboxes/${id}/messages/${messageId}`),
  messages: (params: { mailbox?: string; folder: Folder; search?: string; cursor?: string; starred?: boolean }) => {
    const query = new URLSearchParams({ folder: params.folder });
    if (params.mailbox) query.set("mailbox", params.mailbox);
    if (params.search) query.set("search", params.search);
    if (params.starred !== undefined) query.set("starred", String(params.starred));
    if (params.cursor) query.set("cursor", params.cursor);
    return request<{ messages: MessageSummary[]; nextCursor: string | null }>(`/api/messages?${query}`);
  },
  message: (id: string) => request<{ message: MessageDetail }>(`/api/messages/${id}`),
  patchMessage: (id: string, patch: { isRead?: boolean; isStarred?: boolean; folder?: Folder }) => request<{ message: Pick<MessageDetail, "id" | "is_read" | "is_starred" | "folder"> }>(`/api/messages/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteMessage: (id: string) => request<void>(`/api/messages/${id}`, { method: "DELETE" }),
  sendMessage: (message: { mailboxId: string; to: string[]; cc: string[]; subject: string; text: string; replyToMessageId?: string }) => request<{ message: { id: string; internetMessageId: string }; status: "queued" }>("/api/messages/send", { method: "POST", body: JSON.stringify(message) }),
};
