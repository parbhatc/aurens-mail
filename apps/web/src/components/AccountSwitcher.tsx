import { Check, LogOut, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Mailbox } from "../types";

interface Props {
  mailboxes: Mailbox[];
  mailboxId: string | undefined;
  canManage: boolean;
  deleting: boolean;
  onSelect: (id?: string) => void;
  onAdd: () => void;
  onRemove: () => void;
  onLogout: () => void;
}

export function AccountSwitcher({ mailboxes, mailboxId, canManage, deleting, onSelect, onAdd, onRemove, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const activeMailboxes = mailboxes.filter((item) => item.is_active);
  const selected = activeMailboxes.find((item) => item.id === mailboxId);
  const label = selected?.display_name || selected?.address || "All mail accounts";
  const initial = (selected?.display_name || selected?.address || "A")[0]?.toUpperCase() || "A";

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("mousedown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [open]);

  const select = (id?: string) => { onSelect(id); setOpen(false); };
  return <div className="account-menu" ref={root}>
    <button className="account-avatar" type="button" aria-label={`Mail account: ${label}`} aria-haspopup="menu" aria-expanded={open} title={label} onClick={() => setOpen((value) => !value)}>{initial}</button>
    {open && <div className="account-popover" role="menu" aria-label="Mail accounts">
      <div className="account-popover-heading"><span>Mail accounts</span><small>Switch inbox</small></div>
      <div className="account-options">
        <button type="button" role="menuitemradio" aria-checked={!mailboxId} className={!mailboxId ? "active" : ""} onClick={() => select()}><span className="account-option-avatar">A</span><span><strong>All accounts</strong><small>Combined inbox</small></span>{!mailboxId && <Check />}</button>
        {activeMailboxes.map((item) => <button key={item.id} type="button" role="menuitemradio" aria-checked={mailboxId === item.id} className={mailboxId === item.id ? "active" : ""} onClick={() => select(item.id)}><span className="account-option-avatar">{(item.display_name || item.address)[0]?.toUpperCase()}</span><span><strong>{item.display_name || item.address.split("@")[0]}</strong><small>{item.address}</small></span>{mailboxId === item.id && <Check />}</button>)}
      </div>
      {canManage && <div className="account-actions"><button type="button" role="menuitem" onClick={() => { setOpen(false); onAdd(); }}><Plus />Add account</button></div>}
      <div className="account-footer-actions">{canManage && selected && <button type="button" role="menuitem" className="account-delete" disabled={deleting} onClick={() => { setOpen(false); onRemove(); }}><Trash2 />Delete</button>}<button type="button" role="menuitem" className="account-signout" onClick={() => { setOpen(false); onLogout(); }}><LogOut />Sign out</button></div>
    </div>}
  </div>;
}
