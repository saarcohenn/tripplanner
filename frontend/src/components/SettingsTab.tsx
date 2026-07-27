import { useEffect, useState } from "react";
import { api } from "../api";
import type { Settings, User } from "../types";

const STATUS_LABEL: Record<string, string> = { pending: "⏳ Pending", approved: "✅ Approved", rejected: "🚫 Rejected" };

function AdminUsersPanel({ currentUser }: { currentUser: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

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

  return (
    <div className="pad narrow">
      <h2>Users</h2>
      <p className="hint">New signups need your approval before they can log in.</p>
      <table className="table">
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td dir="auto"><strong>{u.display_name || u.email}</strong><div className="hint">{u.email}</div></td>
              <td>{STATUS_LABEL[u.status] || u.status}</td>
              <td>{u.role}</td>
              <td className="row" style={{ gap: 6 }}>
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
        <p className="hint">✅ Currently using the key from the <code>GOOGLE_MAPS_API_KEY</code> environment variable (docker-compose). Saving a value here would override it; leave blank to keep using the env var.</p>
      )}
      <button className="primary" onClick={save}>Save</button>
      {status && <p dir="auto">{status}</p>}
    </div>
  );
}
