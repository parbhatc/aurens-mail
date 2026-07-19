import { Mail, Moon, PenLine, RefreshCw, Search, SlidersHorizontal, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "./api";
import { ComposeMessage } from "./components/ComposeMessage";
import { CreateMailbox } from "./components/CreateMailbox";
import { Login } from "./components/Login";
import { MessageList } from "./components/MessageList";
import { MessageReader } from "./components/MessageReader";
import { MobileDock, MobileMenuButton, Sidebar } from "./components/Sidebar";
import type { Folder, Mailbox, MessageDetail, MessageSummary, SessionUser } from "./types";

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("aurens-theme");
      if (saved === "light" || saved === "dark") return saved;
      return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch { return "light"; }
  });
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [detail, setDetail] = useState<MessageDetail>();
  const [selectedId, setSelectedId] = useState<string>();
  const [mailboxId, setMailboxId] = useState<string>();
  const [folder, setFolder] = useState<Folder>("inbox");
  const [starred, setStarred] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<MessageDetail>();
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem("aurens-theme", theme); } catch { /* Storage may be disabled. */ }
  }, [theme]);
  useEffect(() => {
    document.documentElement.classList.toggle("nav-open", navOpen);
    document.body.classList.toggle("nav-open", navOpen);
    return () => {
      document.documentElement.classList.remove("nav-open");
      document.body.classList.remove("nav-open");
    };
  }, [navOpen]);
  useEffect(() => { void api.session().then(({ user }) => setSession(user)).catch(() => setSession(null)); }, []);
  const loadMailboxes = useCallback(async () => setMailboxes((await api.mailboxes()).mailboxes), []);
  useEffect(() => { if (session) void loadMailboxes(); }, [session, loadMailboxes]);

  const loadMessages = useCallback(async (append = false, cursor?: string) => {
    setLoading(true); setError("");
    try {
      const result = await api.messages({ folder, ...(mailboxId ? { mailbox: mailboxId } : {}), ...(query ? { search: query } : {}), ...(cursor ? { cursor } : {}), ...(starred ? { starred: true } : {}) });
      setMessages((current) => append ? [...current, ...result.messages] : result.messages);
      setNextCursor(result.nextCursor);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) setSession(null);
      else setError(reason instanceof Error ? reason.message : "Unable to load mail.");
    } finally { setLoading(false); }
  }, [folder, mailboxId, query, starred]);
  useEffect(() => { if (session) void loadMessages(); }, [session, loadMessages]);

  const selectMessage = async (id: string) => {
    setSelectedId(id); setDetailLoading(true); setError("");
    try {
      const result = await api.message(id); setDetail(result.message);
      if (!result.message.is_read) {
        await api.patchMessage(id, { isRead: true });
        setMessages((items) => items.map((item) => item.id === id ? { ...item, is_read: true } : item));
        void loadMailboxes();
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to open message."); }
    finally { setDetailLoading(false); }
  };

  const patchSelected = async (patch: { isRead?: boolean; isStarred?: boolean; folder?: Folder }) => {
    if (!selectedId) return;
    try {
      await api.patchMessage(selectedId, patch);
      if (patch.folder && patch.folder !== folder) {
        setMessages((items) => items.filter((item) => item.id !== selectedId)); setDetail(undefined); setSelectedId(undefined);
      } else {
        setDetail((item) => item ? { ...item, ...(patch.isRead !== undefined ? { is_read: patch.isRead } : {}), ...(patch.isStarred !== undefined ? { is_starred: patch.isStarred } : {}), ...(patch.folder ? { folder: patch.folder } : {}) } : item);
        setMessages((items) => items.map((item) => item.id === selectedId ? { ...item, ...(patch.isRead !== undefined ? { is_read: patch.isRead } : {}), ...(patch.isStarred !== undefined ? { is_starred: patch.isStarred } : {}), ...(patch.folder ? { folder: patch.folder } : {}) } : item));
      }
      void loadMailboxes();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update message."); }
  };

  const closeReader = () => { setSelectedId(undefined); setDetail(undefined); };
  const selectMailbox = (id?: string) => { setMailboxId(id); closeReader(); setNavOpen(false); };
  const selectFolder = (value: Folder) => { setFolder(value); setStarred(false); closeReader(); setNavOpen(false); };
  const selectStarred = () => { setFolder("inbox"); setStarred(true); closeReader(); setNavOpen(false); };
  const openComposer = () => { setReplyTarget(undefined); setComposeOpen(true); };
  const toggleTheme = () => setTheme((current) => current === "dark" ? "light" : "dark");
  const logout = async () => { await api.logout().catch(() => undefined); setSession(null); };
  const refreshInbox = async () => { await Promise.all([loadMessages(), loadMailboxes()]); };
  const removeSelected = async () => {
    if (!selectedId || !confirm("Permanently delete this message and all attachments? This cannot be undone.")) return;
    await api.deleteMessage(selectedId); setMessages((items) => items.filter((item) => item.id !== selectedId)); closeReader();
  };

  if (session === undefined) return <div className="boot-screen"><div className="brand-mark pulse">A</div></div>;
  if (!session) return <Login onLogin={setSession} />;

  const mailbox = mailboxes.find((item) => item.id === mailboxId);
  const unread = mailboxes.reduce((sum, item) => sum + Number(item.unread_count), 0);

  return <div className="app-shell">
    <Sidebar user={session} mailboxes={mailboxes} mailboxId={mailboxId} folder={folder} starred={starred} open={navOpen} theme={theme} onToggleTheme={toggleTheme} onClose={() => setNavOpen(false)} onLogout={() => void logout()} onSelectMailbox={selectMailbox} onSelectFolder={selectFolder} onSelectStarred={selectStarred} onCreateMailbox={() => setCreateOpen(true)} onCompose={openComposer} />
    <main className={`mail-pane ${selectedId ? "has-reader" : ""}`}>
      <header className="topbar">
        <div className="mobile-topline"><MobileMenuButton onClick={() => setNavOpen(true)} /><div className="mobile-identity"><span className="mobile-brand-mark"><Mail /></span><span><strong>Aurens</strong><small>Mail</small></span></div><button className="mobile-theme" aria-label={`Use ${theme === "dark" ? "light" : "dark"} mode`} title={`Use ${theme === "dark" ? "light" : "dark"} mode`} onClick={toggleTheme}>{theme === "dark" ? <Sun /> : <Moon />}</button></div>
        <div className="search-box"><Search /><input aria-label="Search mail" placeholder="Search mail" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") setQuery(search.trim()); }} /><button aria-label="Run search" title="Search" onClick={() => setQuery(search.trim())}><SlidersHorizontal /></button></div>
        <button className="top-compose" onClick={openComposer}><PenLine /><span>New message</span></button>
      </header>
      <section className="inbox-panel">
        <div className="inbox-heading"><div><p className="eyebrow">{starred ? "STARRED" : folder.toUpperCase()}</p><h1>{mailbox?.display_name || mailbox?.address || "All mailboxes"}</h1></div><div className="inbox-actions"><span aria-live="polite">{messages.length}{nextCursor ? "+" : ""} message{messages.length === 1 ? "" : "s"}</span><button className="refresh-button" aria-label="Refresh inbox" title="Refresh inbox" disabled={loading} onClick={() => void refreshInbox()}><RefreshCw className={loading ? "spin" : ""} /></button></div></div>
        {error && <div className="global-error" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
        <MessageList messages={messages} folder={folder} selectedId={selectedId} loading={loading} hasMore={Boolean(nextCursor)} onSelect={(id) => void selectMessage(id)} onStar={(item) => { void api.patchMessage(item.id, { isStarred: !item.is_starred }).then(() => setMessages((rows) => rows.map((row) => row.id === item.id ? { ...row, is_starred: !row.is_starred } : row))); }} onMore={() => nextCursor && void loadMessages(true, nextCursor)} />
      </section>
      <MessageReader message={detail} loading={detailLoading} onClose={closeReader} onPatch={(patch) => void patchSelected(patch)} onDelete={() => void removeSelected()} onReply={(message) => { setReplyTarget(message); setComposeOpen(true); }} />
    </main>
    {!selectedId && <button className="mobile-compose-fab" aria-label="Compose new message" onClick={openComposer}><PenLine /><span>Compose</span></button>}
    {!selectedId && <MobileDock folder={folder} starred={starred} unread={unread} onSelectFolder={selectFolder} onSelectStarred={selectStarred} onOpenMenu={() => setNavOpen(true)} />}
    {createOpen && <CreateMailbox onClose={() => setCreateOpen(false)} onCreate={async (address, name, catchAll) => { await api.createMailbox(address, name, catchAll); await loadMailboxes(); }} />}
    {composeOpen && <ComposeMessage mailboxes={mailboxes} {...(mailboxId ? { defaultMailboxId: mailboxId } : {})} {...(replyTarget ? { replyTo: replyTarget } : {})} onClose={() => { setComposeOpen(false); setReplyTarget(undefined); }} onSent={(sentMailboxId) => { setComposeOpen(false); setReplyTarget(undefined); setMailboxId(sentMailboxId); setFolder("sent"); setStarred(false); closeReader(); }} />}
  </div>;
}
