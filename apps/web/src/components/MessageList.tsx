import { AlertTriangle, Inbox, LoaderCircle, Paperclip, Star } from "lucide-react";
import type { Folder, MessageSummary } from "../types";

function formatTime(value: string): string {
  const date = new Date(value); const now = new Date();
  if (date.toDateString() === now.toDateString()) return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

interface Props {
  messages: MessageSummary[];
  folder: Folder;
  selectedId: string | undefined;
  loading: boolean;
  hasMore: boolean;
  onSelect: (id: string) => void;
  onStar: (item: MessageSummary) => void;
  onMore: () => void;
}

export function MessageList(props: Props) {
  if (props.loading && props.messages.length === 0) return <div className="state-panel"><LoaderCircle className="spin" /><h3>Gathering your mail</h3></div>;
  if (!props.loading && props.messages.length === 0) return <div className="state-panel"><Inbox /><h3>Nothing here yet</h3><p>{props.folder === "sent" ? "Messages you send will appear here." : "New messages will appear as soon as they arrive."}</p></div>;

  return <div className="message-list" role="list">
    {props.messages.map((item) => {
      const sender = props.folder === "sent" ? item.recipient_address : item.sender_name || item.sender_address;
      return <article key={item.id} role="listitem" tabIndex={0} className={`message-row ${!item.is_read ? "unread" : ""} ${props.selectedId === item.id ? "selected" : ""}`} onClick={() => props.onSelect(item.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); props.onSelect(item.id); } }}>
        <div className="message-avatar" aria-hidden="true">{sender[0]?.toUpperCase() || "?"}</div>
        <div className="message-copy">
          <div className="sender-line"><strong>{props.folder === "sent" ? `To: ${item.recipient_address}` : item.sender_name || item.sender_address}</strong><span className="message-meta"><time>{formatTime(item.received_at)}</time><button className={`star-button ${item.is_starred ? "starred" : ""}`} aria-label={item.is_starred ? "Unstar" : "Star"} onClick={(event) => { event.stopPropagation(); props.onStar(item); }}><Star /></button></span></div>
          <div className="subject-line"><span>{item.subject || "(No subject)"}</span>{item.has_attachments && <Paperclip />}{item.warning && <AlertTriangle className="warning-icon" />}</div>
          <p>{item.preview || "No message preview"}</p>
          <small className="recipient-chip">{props.folder === "sent" ? `from ${item.mailbox_address}` : `to ${item.mailbox_address}`}</small>
        </div>
      </article>;
    })}
    {props.hasMore && <button className="load-more" disabled={props.loading} onClick={props.onMore}>{props.loading ? "Loading…" : "Load older messages"}</button>}
  </div>;
}
