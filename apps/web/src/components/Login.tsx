import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import { api } from "../api";
import type { SessionUser } from "../types";

export function Login({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [email, setEmail] = useState("admin@aurens.app");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { onLogin((await api.login(email, password)).user); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to sign in."); }
    finally { setBusy(false); }
  };
  return <main className="login-shell">
    <section className="login-card">
      <div className="brand-mark"><Mail size={24} strokeWidth={1.8} /></div>
      <p className="eyebrow">PRIVATE MAIL</p>
      <h1>Your inbox,<br />quietly yours.</h1>
      <p className="login-subtitle">Secure custom mail for aurens.app.</p>
      <form onSubmit={submit}>
        <label>Email address<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={5} required /></label>
        {error && <div className="form-error" role="alert"><LockKeyhole size={16} />{error}</div>}
        <button className="primary-button" disabled={busy}>{busy ? "Signing in…" : "Enter inbox"}<ArrowRight size={18} /></button>
      </form>
    </section>
  </main>;
}
