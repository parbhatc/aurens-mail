import { Check, Copy, Inbox, LoaderCircle, MailOpen, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../api";
import type { TempMailbox, TempMessageDetail, TempMessageSummary } from "../types";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { iframeHtml } from "./MessageReader";

export function TempMailPage() {
  const [mailboxes, setMailboxes] = useState<TempMailbox[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [messages, setMessages] = useState<TempMessageSummary[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<TempMessageDetail>();
  const [localPart, setLocalPart] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [copied, setCopied] = useState<"address" | "token">();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const selected = mailboxes.find((item) => item.id === selectedId);
  const renderedHtml = useMemo(() => selectedMessage?.html ? iframeHtml(selectedMessage.html, selectedMessage.attachments) : "", [selectedMessage]);

  const loadMailboxes = useCallback(async () => {
    try {
      const result = await api.tempMailboxes();
      setMailboxes(result.mailboxes);
      setSelectedId((current) => current && result.mailboxes.some((item) => item.id === current) ? current : result.mailboxes[0]?.id);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load temporary mailboxes.");
    } finally { setLoading(false); }
  }, []);

  const loadMessages = useCallback(async (mailboxId: string) => {
    try {
      const result = await api.tempMessages(mailboxId);
      setMessages(result.messages);
      setSelectedMessage(undefined);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load temporary mail."); }
  }, []);

  useEffect(() => { void loadMailboxes(); }, [loadMailboxes]);
  useEffect(() => { if (selectedId) void loadMessages(selectedId); else setMessages([]); }, [selectedId, loadMessages]);

  const create = async (event: FormEvent) => {
    event.preventDefault(); setCreating(true); setError(""); setAccessToken("");
    try {
      const result = await api.createTempMailbox(localPart.trim().toLowerCase());
      setAccessToken(result.accessToken); setLocalPart("");
      await loadMailboxes(); setSelectedId(result.mailbox.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create temporary mail."); }
    finally { setCreating(false); }
  };

  const copy = async (value: string, kind: "address" | "token") => {
    await navigator.clipboard.writeText(value); setCopied(kind);
    window.setTimeout(() => setCopied(undefined), 1600);
  };

  const remove = async () => {
    if (!selected) return;
    setDeleting(true);
    try {
      await api.deleteTempMailbox(selected.id); setConfirmDelete(false); setAccessToken(""); setSelectedMessage(undefined);
      await loadMailboxes();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to delete temporary mail."); }
    finally { setDeleting(false); }
  };

  return <section className="temp-mail-page">
    <header className="temp-hero"><div><p className="eyebrow">DISPOSABLE INBOXES</p><h1>Temporary mail</h1><p>Create an address for a quick signup or test. Keep it for as long as you need, read its full inbox, and delete it when you are finished.</p></div><div className="temp-privacy"><ShieldCheck /><span><strong>Private by default</strong><small>Each API inbox has its own access token.</small></span></div></header>
    {error && <div className="global-error" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
    <div className="temp-layout">
      <aside className="temp-create-card">
        <form onSubmit={(event) => void create(event)}><div><p className="eyebrow">NEW ADDRESS</p><h2>Start a temp inbox</h2></div><label htmlFor="temp-local">Custom address <small>Optional</small><div className="address-input"><input id="temp-local" value={localPart} onChange={(event) => setLocalPart(event.target.value.replace(/[^a-zA-Z0-9._-]/g, ""))} placeholder="random if blank" /><span>@aurens.app</span></div></label><p className="temp-persistence-note"><ShieldCheck />Stays available until you delete it.</p><button className="primary-button" disabled={creating}>{creating ? <><LoaderCircle className="spin" />Creating…</> : <><Plus />Create temp address</>}</button></form>
        {accessToken && <div className="temp-token"><p><ShieldCheck />API access token</p><code>{accessToken}</code><button type="button" onClick={() => void copy(accessToken, "token")}>{copied === "token" ? <Check /> : <Copy />}{copied === "token" ? "Copied" : "Copy token"}</button><small>Save it now. For security, it is only shown once.</small></div>}
        <div className="temp-mailbox-list"><div className="temp-list-heading"><span>ACTIVE INBOXES</span><button type="button" aria-label="Refresh temporary inboxes" title="Refresh" onClick={() => void loadMailboxes()}><RefreshCw /></button></div>{loading ? <LoaderCircle className="spin temp-loader" /> : mailboxes.length === 0 ? <p className="temp-empty-copy">No temporary addresses yet.</p> : mailboxes.map((item) => <button type="button" className={selectedId === item.id ? "active" : ""} key={item.id} onClick={() => setSelectedId(item.id)}><span className="temp-address-avatar">T</span><span><strong>{item.address}</strong><small>{Number(item.message_count ?? 0)} message{Number(item.message_count ?? 0) === 1 ? "" : "s"} · saved until deleted</small></span></button>)}</div>
      </aside>
      <div className="temp-inbox-card">
        {!selected ? <div className="temp-empty"><MailOpen /><h2>Create a temporary inbox</h2><p>New messages will appear here as soon as they arrive.</p></div> : <><header className="temp-inbox-heading"><div><p className="eyebrow">SAVED TEMP INBOX</p><h2>{selected.address}</h2><span><ShieldCheck />Available until you delete it</span></div><div><button type="button" onClick={() => void copy(selected.address, "address")}>{copied === "address" ? <Check /> : <Copy />}<span>{copied === "address" ? "Copied" : "Copy"}</span></button><button type="button" onClick={() => void loadMessages(selected.id)}><RefreshCw /><span>Refresh</span></button><button type="button" className="danger" onClick={() => setConfirmDelete(true)}><Trash2 /><span>Delete</span></button></div></header><div className="temp-inbox-body"><div className="temp-message-list">{messages.length === 0 ? <div className="temp-empty"><Inbox /><h3>Waiting for mail</h3><p>Send a message to {selected.address}, then refresh.</p></div> : messages.map((message) => <button type="button" className={selectedMessage?.id === message.id ? "active" : ""} key={message.id} onClick={() => void api.tempMessage(selected.id, message.id).then((result) => setSelectedMessage(result.message)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to read the message."))}><span className="temp-message-avatar">{(message.sender_name || message.sender_address)[0]?.toUpperCase()}</span><span><strong>{message.sender_name || message.sender_address}</strong><b>{message.subject || "(No subject)"}</b><small>{message.preview || "No preview available"}</small></span><time>{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(message.received_at))}</time></button>)}</div><article className="temp-message-reader">{!selectedMessage ? <div className="temp-empty"><MailOpen /><h3>Select a message</h3><p>HTML and text email content will open here.</p></div> : <><header><p className="eyebrow">{selectedMessage.sender_name || selectedMessage.sender_address}</p><h2>{selectedMessage.subject || "(No subject)"}</h2><span>From &lt;{selectedMessage.sender_address}&gt; · {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(selectedMessage.received_at))}</span></header><div className="temp-message-content">{selectedMessage.html ? <iframe title="Temporary email content" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={renderedHtml} /> : <pre>{selectedMessage.text || "This message has no readable body."}</pre>}</div></>}</article></div></>}
      </div>
    </div>
    {confirmDelete && selected && <ConfirmActionDialog eyebrow="DELETE TEMP ADDRESS" title={`Delete ${selected.address}?`} description="The address, every message, and all attachments will be permanently deleted immediately." confirmLabel="Delete temp inbox" busyLabel="Deleting…" busy={deleting} onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove()} />}
  </section>;
}
