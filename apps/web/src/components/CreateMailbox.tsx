import { X } from "lucide-react";
import { useState, type FormEvent } from "react";

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
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await onCreate(`${local.toLowerCase()}@aurens.app`, name, catchAll); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create mailbox."); }
    finally { setBusy(false); }
  };
  return <div className="modal-scrim"><form className="modal" onSubmit={(event) => void submit(event)}><button type="button" className="modal-close" aria-label="Close" onClick={onClose}><X /></button><p className="eyebrow">NEW MAILBOX</p><h2>Create an address</h2><label>Address<div className="address-input"><input value={local} onChange={(event) => setLocal(event.target.value.replace(/[^a-zA-Z0-9._+-]/g, ""))} required autoFocus /><span>@aurens.app</span></div></label><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Customer support" /></label><label className="check-label"><input type="checkbox" checked={catchAll} onChange={(event) => setCatchAll(event.target.checked)} />Use for mail sent to unknown addresses</label>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary-button" disabled={busy}>{busy ? "Creating…" : "Create mailbox"}</button></form></div>;
}
