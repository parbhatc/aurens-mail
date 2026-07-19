import { Archive, Inbox, LogOut, Mail, Menu, Moon, PenLine, Plus, Send, ShieldAlert, Star, Sun, Trash2, X } from "lucide-react";
import type { Folder, Mailbox, SessionUser } from "../types";

interface Props {
  user: SessionUser;
  mailboxes: Mailbox[];
  mailboxId: string | undefined;
  folder: Folder;
  starred: boolean;
  open: boolean;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onSelectMailbox: (id?: string) => void;
  onSelectFolder: (folder: Folder) => void;
  onClose: () => void;
  onLogout: () => void;
  onCreateMailbox: () => void;
  onSelectStarred: () => void;
  onCompose: () => void;
}

export function Sidebar(props: Props) {
  const unread = props.mailboxes.reduce((sum, item) => sum + Number(item.unread_count), 0);
  return <>
    {props.open && <button className="sidebar-scrim" aria-label="Close navigation" onClick={props.onClose} />}
    <aside className={`sidebar ${props.open ? "sidebar-open" : ""}`}>
      <div className="sidebar-brand"><div className="brand-mark small"><Mail size={19} /></div><span><strong>Aurens</strong><small>Private mail</small></span><button className="mobile-close" aria-label="Close navigation" onClick={props.onClose}><X /></button></div>
      <button className="sidebar-compose" onClick={() => { props.onCompose(); props.onClose(); }}><PenLine /><span>New message</span></button>
      <nav className="folder-nav" aria-label="Mail folders">
        <button className={props.folder === "inbox" && !props.starred ? "active" : ""} onClick={() => props.onSelectFolder("inbox")}><Inbox />Inbox{unread > 0 && <span className="count">{unread}</span>}</button>
        <button className={props.starred ? "active" : ""} onClick={props.onSelectStarred}><Star />Starred</button>
        <button className={props.folder === "sent" && !props.starred ? "active" : ""} onClick={() => props.onSelectFolder("sent")}><Send />Sent</button>
        <button className={props.folder === "spam" && !props.starred ? "active" : ""} onClick={() => props.onSelectFolder("spam")}><ShieldAlert />Spam</button>
        <button className={props.folder === "trash" && !props.starred ? "active" : ""} onClick={() => props.onSelectFolder("trash")}><Trash2 />Trash</button>
      </nav>
      <div className="mailbox-heading"><span>MAILBOXES</span>{props.user.role !== "member" && <button onClick={props.onCreateMailbox} aria-label="Create mailbox" title="Create mailbox"><Plus /></button>}</div>
      <nav className="mailbox-list" aria-label="Mailboxes">
        <button className={!props.mailboxId ? "active" : ""} onClick={() => props.onSelectMailbox(undefined)}><Archive /><span>All mailboxes</span></button>
        {props.mailboxes.filter((item) => item.is_active).map((item) => <button key={item.id} className={props.mailboxId === item.id ? "active" : ""} onClick={() => props.onSelectMailbox(item.id)}>
          <span className="mailbox-dot" /><span className="mailbox-label">{item.display_name || item.address.split("@")[0]}<small>{item.address}</small></span>{Number(item.unread_count) > 0 && <span className="count">{item.unread_count}</span>}
        </button>)}
      </nav>
      <button className="theme-toggle" onClick={props.onToggleTheme}>{props.theme === "dark" ? <Sun /> : <Moon />}<span>{props.theme === "dark" ? "Light mode" : "Dark mode"}</span></button>
      <div className="user-card"><div className="avatar">{(props.user.displayName || props.user.email)[0]?.toUpperCase()}</div><div><strong>{props.user.displayName || "Owner"}</strong><small>{props.user.email}</small></div><button onClick={props.onLogout} aria-label="Sign out" title="Sign out"><LogOut /></button></div>
    </aside>
  </>;
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return <button className="mobile-menu" aria-label="Open navigation" onClick={onClick}><Menu /></button>;
}

interface MobileDockProps {
  folder: Folder;
  starred: boolean;
  unread: number;
  onSelectFolder: (folder: Folder) => void;
  onSelectStarred: () => void;
  onOpenMenu: () => void;
}

export function MobileDock(props: MobileDockProps) {
  return <nav className="mobile-dock" aria-label="Primary mail navigation">
    <button className={props.folder === "inbox" && !props.starred ? "active" : ""} onClick={() => props.onSelectFolder("inbox")}><span><Inbox />{props.unread > 0 && <b>{props.unread > 99 ? "99+" : props.unread}</b>}</span><small>Inbox</small></button>
    <button className={props.starred ? "active" : ""} onClick={props.onSelectStarred}><Star /><small>Starred</small></button>
    <button className={props.folder === "sent" && !props.starred ? "active" : ""} onClick={() => props.onSelectFolder("sent")}><Send /><small>Sent</small></button>
    <button onClick={props.onOpenMenu}><Menu /><small>More</small></button>
  </nav>;
}
