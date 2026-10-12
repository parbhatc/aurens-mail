import { X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

interface Props {
  onClose: () => void;
  onCreate: (address: string, name: string, catchAll: boolean) => Promise<void>;
}

export function CreateMailbox({ onClose, onCreate }: Props) {
  const [local, setLocal] = useState("");
  const [name, setName] = useState("");
  const [catchAll, setCatchAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await onCreate(`${local.toLowerCase()}@aurens.app`, name, catchAll); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create mailbox."); }
    finally { setBusy(false); }
  };
  return <div className="modal-scrim"><form className="modal" role="dialog" aria-modal="true" aria-labelledby="create-mailbox-title" onSubmit={(event) => void submit(event)}><button type="button" className="modal-close" aria-label="Close add account dialog" onClick={onClose}><X /></button><p className="eyebrow">NEW MAIL ACCOUNT</p><h2 id="create-mailbox-title">Create an address</h2><p className="modal-description">Add another @aurens.app address and use the account menu to switch between inboxes.</p><label htmlFor="mailbox-address">Address<div className="address-input"><input id="mailbox-address" aria-describedby="mailbox-domain" autoComplete="off" value={local} onChange={(event) => setLocal(event.target.value.replace(/[^a-zA-Z0-9._+-]/g, ""))} required autoFocus /><span id="mailbox-domain">@aurens.app</span></div></label><label htmlFor="mailbox-name">Display name<input id="mailbox-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Customer support" /></label><label className="check-label"><input type="checkbox" checked={catchAll} onChange={(event) => setCatchAll(event.target.checked)} />Use for mail sent to unknown addresses</label>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary-button" disabled={busy}>{busy ? "Creating…" : "Add mail account"}</button></form></div>;
}
