import { AlertTriangle, ArrowLeft, Download, Eye, EyeOff, File, LoaderCircle, MailOpen, Paperclip, Reply, ShieldAlert, Star, Trash2, Undo2, X } from "lucide-react";
import { useMemo, type SyntheticEvent } from "react";
import type { Attachment, Folder, MessageDetail } from "../types";

function size(value: number): string { return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }

export function iframeHtml(body: string, attachments: Attachment[] = []): string {
  let content = body.replace(/src=("|')cid:([^"']+)\1/gi, (attribute, quote: string, contentId: string) => {
    const normalized = contentId.replace(/^<|>$/g, "").toLowerCase();
    const attachment = attachments.find((item) => item.content_id?.replace(/^<|>$/g, "").toLowerCase() === normalized);
    return attachment ? `src=${quote}/api/attachments/${encodeURIComponent(attachment.id)}/download${quote}` : attribute;
  });
  content = content.replace(/data-remote-src=("|')([^"']+)\1/g, "src=$1$2$1");

  return `<!doctype html><html><head><meta name="referrer" content="no-referrer"><base target="_blank"><style>
    :root{color-scheme:light}*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#242721}
    body{width:100%;max-width:800px;margin:0 auto;padding:24px clamp(18px,4vw,36px);font:15px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-wrap:anywhere}
    body> :first-child{margin-top:0}body> :last-child{margin-bottom:0}
    img{max-width:100%!important;height:auto!important}
    table{max-width:100%!important;border-collapse:collapse}td,th{max-width:100%;overflow-wrap:anywhere}
    pre{max-width:100%;white-space:pre-wrap}blockquote{margin:1em 0;padding-left:14px;border-left:3px solid #dfe5df;color:#596159}
    a{color:#376b50}hr{border:0;border-top:1px solid #e6e8e3}
  </style></head><body>${content}</body></html>`;
}

function fitIframe(event: SyntheticEvent<HTMLIFrameElement>) {
  const frame = event.currentTarget;
  const document = frame.contentDocument;
  if (!document) return;
  const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  frame.style.height = `${Math.min(6000, Math.max(120, height))}px`;
}

interface Props {
  message: MessageDetail | undefined;
  loading: boolean;
  onClose: () => void;
  onPatch: (patch: { isRead?: boolean; isStarred?: boolean; folder?: Folder }) => void;
  onDelete: () => void;
  onReply: (message: MessageDetail) => void;
}

export function MessageReader({ message, loading, onClose, onPatch, onDelete, onReply }: Props) {
  const html = useMemo(() => message?.html ? iframeHtml(message.html, message.attachments) : "", [message?.html, message?.attachments]);
  if (loading) return <section className="reader state-panel"><LoaderCircle className="spin" /></section>;
  if (!message) return <section className="reader empty-reader"><MailOpen /><h2>Select a message</h2><p>Choose an email to read it here.</p></section>;

  return <section className="reader" aria-labelledby="message-subject">
    <header className="reader-toolbar" aria-label="Message actions"><button className="reader-back" aria-label="Back to inbox" onClick={onClose}><ArrowLeft /></button><div className="toolbar-spacer" />
      {message.folder !== "sent" && <button className="reader-reply" aria-label="Reply" title="Reply" onClick={() => onReply(message)}><Reply /><span>Reply</span></button>}
      {message.folder !== "sent" && <button aria-label={message.is_read ? "Mark unread" : "Mark read"} title={message.is_read ? "Mark unread" : "Mark read"} onClick={() => onPatch({ isRead: !message.is_read })}>{message.is_read ? <EyeOff /> : <Eye />}</button>}
      <button aria-label={message.is_starred ? "Unstar" : "Star"} title={message.is_starred ? "Unstar" : "Star"} className={message.is_starred ? "starred" : ""} onClick={() => onPatch({ isStarred: !message.is_starred })}><Star /></button>
      {message.folder === "trash" ? <button aria-label="Restore" title="Restore" onClick={() => onPatch({ folder: "inbox" })}><Undo2 /></button> : <button aria-label="Move to trash" title="Move to trash" onClick={() => onPatch({ folder: "trash" })}><Trash2 /></button>}
      {message.folder !== "spam" && message.folder !== "sent" && <button aria-label="Move to spam" title="Move to spam" onClick={() => onPatch({ folder: "spam" })}><ShieldAlert /></button>}
      {message.folder === "trash" && <button className="danger" aria-label="Delete forever" title="Delete forever" onClick={onDelete}><X /></button>}
    </header>
    <div className="reader-scroll">
      <div className="reader-title"><p className="eyebrow">{message.mailbox_address}</p><h2 id="message-subject">{message.subject || "(No subject)"}</h2></div>
      <div className="sender-card"><div className="avatar sender-avatar">{(message.folder === "sent" ? message.recipient_address : message.sender_name || message.sender_address)[0]?.toUpperCase()}</div><div>{message.folder === "sent" ? <><strong>To: {message.recipient_address}</strong><span>from {message.mailbox_address}</span></> : <><strong>{message.sender_name || message.sender_address}</strong><span>&lt;{message.sender_address}&gt;</span><small>to {message.recipient_address}</small></>}</div><time>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(message.received_at))}</time></div>
      {message.warning && <div className="warning-banner"><AlertTriangle />{message.warning}</div>}
      <div className="message-body">{message.html ? <iframe key={message.id} title="Email content" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={html} onLoad={fitIframe} /> : <pre>{message.text || "This message has no readable body."}</pre>}</div>
      {message.attachments.length > 0 && <section className="attachments"><h3><Paperclip />{message.attachments.length} attachment{message.attachments.length === 1 ? "" : "s"}</h3><div>{message.attachments.map((item) => <a key={item.id} href={`/api/attachments/${item.id}/download`}><File /><span><strong>{item.filename}</strong><small>{item.content_type} · {size(item.size_bytes)}</small></span>{item.is_suspicious && <AlertTriangle className="warning-icon" />}<Download /></a>)}</div></section>}
      <a className="raw-link" href={`/api/messages/${message.id}/raw`}><Download />Download original .eml</a>
    </div>
    {message.folder !== "sent" && <button className="reader-mobile-reply" onClick={() => onReply(message)}><Reply /><span>Reply to {message.sender_name || message.sender_address}</span></button>}
  </section>;
}
