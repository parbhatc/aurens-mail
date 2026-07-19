import { Mail, Send, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "../api";
import type { Mailbox, MessageDetail } from "../types";

interface Props {
  mailboxes: Mailbox[];
  defaultMailboxId?: string;
  replyTo?: MessageDetail;
  onClose: () => void;
  onSent: (mailboxId: string) => void;
}

function replySubject(subject: string | null): string {
  const value = subject?.trim() || "(No subject)";
  return /^re:/i.test(value) ? value : `Re: ${value}`;
}

function addresses(value: string): string[] {
  return value.split(/[;,\s]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export function ComposeMessage({ mailboxes, defaultMailboxId, replyTo, onClose, onSent }: Props) {
  const activeMailboxes = useMemo(() => mailboxes.filter((item) => item.is_active && !item.is_catch_all), [mailboxes]);
  const preferredMailbox = replyTo?.mailbox_id || defaultMailboxId;
  const [mailboxId, setMailboxId] = useState(preferredMailbox && activeMailboxes.some((item) => item.id === preferredMailbox) ? preferredMailbox : activeMailboxes[0]?.id ?? "");
  const [to, setTo] = useState(replyTo ? (replyTo.reply_to || replyTo.sender_address) : "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(replyTo ? replySubject(replyTo.subject) : "");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api.sendMessage({ mailboxId, to: addresses(to), cc: addresses(cc), subject, text: body, ...(replyTo ? { replyToMessageId: replyTo.id } : {}) });
      onSent(mailboxId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to send the message.");
    } finally { setBusy(false); }
  };

  return <div className="modal-scrim compose-scrim"><form className="compose-modal" aria-label={replyTo ? "Reply to message" : "Compose new message"} onSubmit={(event) => void submit(event)}>
    <header><div><p className="eyebrow">{replyTo ? "REPLY" : "NEW MESSAGE"}</p><h2>{replyTo ? "Write a reply" : "Compose mail"}</h2></div><button type="button" aria-label="Close composer" onClick={onClose}><X /></button></header>
    <div className="compose-fields">
      <label>From<select value={mailboxId} onChange={(event) => setMailboxId(event.target.value)} required>{activeMailboxes.map((item) => <option key={item.id} value={item.id}>{item.address}</option>)}</select></label>
      <label>To<input type="text" inputMode="email" autoComplete="off" value={to} onChange={(event) => setTo(event.target.value)} placeholder="person@example.com" required autoFocus={!replyTo} /></label>
      <label>Cc <span>optional</span><input type="text" inputMode="email" autoComplete="off" value={cc} onChange={(event) => setCc(event.target.value)} /></label>
      <label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={500} /></label>
    </div>
    {replyTo && <div className="reply-context"><Mail />Replying to {replyTo.sender_name || replyTo.sender_address}</div>}
    <label className="compose-body">Message<textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={200000} required placeholder="Write your message…" /></label>
    {error && <div className="form-error" role="alert">{error}</div>}
    <footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !mailboxId}>{busy ? "Sending…" : <><Send />Send message</>}</button></footer>
  </form></div>;
}
