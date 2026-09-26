import { useEffect, useState } from "react";
import { api } from "../api";
import type { Settings, User } from "../types";

const STATUS_LABEL: Record<string, string> = { pending: "⏳ Pending", approved: "Approved", rejected: "Rejected" };

/* No l/I/1 or O/0: an admin reads this one out or types it into a message, so the characters
   that get mistaken for each other are worth giving up. */
const PW_CHARS = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(): string {
  const picks = [...crypto.getRandomValues(new Uint32Array(16))].map((n) => PW_CHARS[n % PW_CHARS.length]);
  return [0, 4, 8, 12].map((i) => picks.slice(i, i + 4).join("")).join("-");
}

function AdminUsersPanel({ currentUser }: { currentUser: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  // Which row has the reset form open, what is typed in it, and how the last attempt went.
  const [resetId, setResetId] = useState<number | null>(null);
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = () => api.get<User[]>("/admin/users").then(setUsers).catch(() => {});
  useEffect(() => { reload(); }, []);

  async function setStatus(id: number, action: "approve" | "reject") {
    setBusyId(id);
    try {
      await api.post(`/admin/users/${id}/${action}`);
      await reload();
    } catch (e: any) {
      window.alert(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function setRole(id: number, role: "admin" | "user") {
    setBusyId(id);
    try {
      await api.post(`/admin/users/${id}/role`, { role });
      await reload();
    } catch (e: any) {
      window.alert(e.message);
    } finally {
      setBusyId(null);
    }
  }

  function openReset(u: User) {
    setResetId(resetId === u.id ? null : u.id);
    setNewPw("");
    setPwMsg(null);
  }

  async function setPassword(u: User) {
    setBusyId(u.id);
    setPwMsg(null);
    try {
      const r = await api.post<{ sessions_ended: number }>(`/admin/users/${u.id}/password`, { password: newPw });
      const ended = r.sessions_ended;
      setPwMsg({
        ok: true,
        text: `Password set for ${u.display_name || u.email}.`
          + (ended > 0 ? ` ${ended} signed-in ${ended === 1 ? "device was" : "devices were"} logged out.` : ""),
      });
    } catch (e: any) {
      setPwMsg({ ok: false, text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="pad narrow">
      <h2>Users</h2>
      <p className="hint">
        New signups need your approval before they can log in. There is no self-service password
        reset — setting one here is how someone locked out gets back in.
      </p>
      {/* One card per person rather than a table: at phone width a four-column table scrolls
          sideways, and the password an admin is reading off the screen ends up off it. */}
      <div className="user-list">
        {users.map((u) => (
          <section className="user-card" key={u.id}>
            <header className="user-head">
              <div className="grow" style={{ minWidth: 0 }}>
                <strong dir="auto">{u.display_name || u.email}</strong>
                <div className="hint" dir="auto">{u.email}</div>
              </div>
              <div className="user-tags">
                <span className={`user-chip status-${u.status}`}>{STATUS_LABEL[u.status] || u.status}</span>
                {u.role === "admin" && <span className="user-chip role">admin</span>}
              </div>
            </header>

            <div className="row wrap user-actions">
              {u.status === "pending" && (
                <>
                  <button className="small" disabled={busyId === u.id} onClick={() => setStatus(u.id, "approve")}>Approve</button>
                  <button className="danger small" disabled={busyId === u.id} onClick={() => setStatus(u.id, "reject")}>Reject</button>
                </>
              )}
              {u.status === "approved" && u.id !== currentUser.id && (
                <>
                  {u.role === "user" ? (
                    <button className="small" disabled={busyId === u.id} onClick={() => setRole(u.id, "admin")}>Make admin</button>
                  ) : (
                    <button className="small" disabled={busyId === u.id} onClick={() => setRole(u.id, "user")}>Remove admin</button>
                  )}
                  <button className="danger small" disabled={busyId === u.id} onClick={() => setStatus(u.id, "reject")}>Disable</button>
                </>
              )}
              {u.status === "rejected" && (
                <button className="small" disabled={busyId === u.id} onClick={() => setStatus(u.id, "approve")}>Re-enable</button>
              )}
              {u.status !== "rejected" && (
                <button className={`small${resetId === u.id ? " active" : ""}`} onClick={() => openReset(u)}>
                  {u.id === currentUser.id ? "Change my password" : "Reset password"}
                </button>
              )}
            </div>

            {resetId === u.id && (
              <div className="pw-reset">
                <label className="block">New password
                  <input
                    className="grow" type="text" value={newPw} placeholder="At least 8 characters"
                    autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    onChange={(e) => { setNewPw(e.target.value); setPwMsg(null); }}
                  />
                </label>
                <div className="row wrap" style={{ gap: 6 }}>
                  <button className="small" onClick={() => { setNewPw(generatePassword()); setPwMsg(null); }}>Generate</button>
                  <button className="primary small" disabled={busyId === u.id || newPw.length < 8} onClick={() => setPassword(u)}>
                    {busyId === u.id ? "…" : "Set password"}
                  </button>
                  <button className="small" onClick={() => openReset(u)}>Close</button>
                </div>
                {pwMsg && (
                  pwMsg.ok
                    ? <p className="hint ok" dir="auto">✓ {pwMsg.text} Hand it over before you close this — it isn't shown again.</p>
                    : <div className="alert small" dir="auto">{pwMsg.text}</div>
                )}
                <p className="hint">
                  {u.id === currentUser.id
                    ? "Your other devices get signed out; this one stays."
                    : "Every device they're signed in on gets signed out."}
                </p>
              </div>
            )}
          </section>
        ))}
      </div>
      {users.length === 0 && <p className="hint">No users yet.</p>}
    </div>
  );
}

export default function SettingsTab({ currentUser }: { currentUser: User }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [gmapsKey, setGmapsKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const reload = () => api.get<Settings>("/settings").then(setSettings).catch(() => {});
  useEffect(() => { reload(); }, []);

  useEffect(() => {
    if (!settings) return;
    // When the key comes from the environment, keep the field blank — saving a value here would override it.
    setGmapsKey(settings.google_maps_key_source === "env" ? "" : settings.google_maps_api_key || "");
  }, [settings]);

  async function save() {
    await api.put("/settings", { google_maps_api_key: gmapsKey });
    await reload();
    setStatus("Saved.");
  }

  return (
    <div className="pad narrow">
      <AdminUsersPanel currentUser={currentUser} />

      <h2>Google Maps</h2>
      <p className="hint">
        Optional. With a Google Maps Platform API key the map switches to Google Maps with English
        labels, search returns English place names, and places get photos. Enable "Maps JavaScript API"
        and "Places API (New)" for the key in Google Cloud Console. Note: unlike an LLM key, this key is
        used by the map in every user's browser — restrict it to your domain in the Cloud Console.
      </p>
      <label className="block">Google Maps API key
        <input
          placeholder={settings?.google_maps_key_source === "env" ? "(provided by GOOGLE_MAPS_API_KEY environment variable)" : "AIza…"}
          value={gmapsKey}
          onChange={(e) => setGmapsKey(e.target.value)}
        />
      </label>
      {settings?.google_maps_key_source === "env" && (
        <p className="hint">Currently using the key from the <code>GOOGLE_MAPS_API_KEY</code> environment variable (docker-compose). Saving a value here would override it; leave blank to keep using the env var.</p>
      )}
      <button className="primary" onClick={save}>Save</button>
      {status && <p dir="auto">{status}</p>}
    </div>
  );
}
