import { useState } from "react";
import { api } from "../api";
import type { User } from "../types";

export default function SetupAdminForm({ onDone }: { onDone: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || !password) return setError("Email and password are required");
    setBusy(true);
    try {
      const r = await api.post<{ user: User }>("/auth/setup", { email, password, display_name: displayName });
      onDone(r.user);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pad auth-screen">
      <h1>TripPlanner</h1>
      <h2>Create the admin account</h2>
      <p className="hint">
        This is a one-time setup — the first account on this server becomes the admin. Once
        created, other people can sign up but will need your approval to get in.
      </p>
      {/* Same shape as the login form, so the browser's password manager offers to keep the
          one password that can never be reset by anyone else. */}
      <form onSubmit={submit}>
        <label className="block">Display name
          <input
            name="name" autoComplete="name" dir="auto"
            value={displayName} onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label className="block">Email
          <input
            type="email" name="email" autoComplete="username" inputMode="email"
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            value={email} onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block">Password
          <input
            type="password" name="password" autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="alert">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create admin account"}
        </button>
      </form>
    </div>
  );
}
