import { useState } from "react";
import { api } from "../api";
import type { User } from "../types";

export default function AuthGate({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setNotice(null);
    if (!email || !password) return setError("Email and password are required");
    setBusy(true);
    try {
      if (mode === "login") {
        const r = await api.post<{ user: User }>("/auth/login", { email, password });
        onLogin(r.user);
      } else {
        await api.post("/auth/signup", { email, password, display_name: displayName });
        setNotice("Account created — an admin needs to approve it before you can log in.");
        setMode("login");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pad narrow auth-screen">
      <h1>🧭 TripPlanner</h1>
      <h2>{mode === "login" ? "Log in" : "Sign up"}</h2>
      {mode === "signup" && (
        <label className="block">Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
      )}
      <label className="block">Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </label>
      <label className="block">Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </label>
      {error && <div className="alert">{error}</div>}
      {notice && <p className="hint">{notice}</p>}
      <button className="primary" onClick={submit} disabled={busy}>
        {busy ? "…" : mode === "login" ? "Log in" : "Sign up"}
      </button>
      <p className="hint">
        {mode === "login" ? (
          <>No account? <button className="inline" onClick={() => { setMode("signup"); setError(null); setNotice(null); }}>Sign up</button></>
        ) : (
          <>Already have an account? <button className="inline" onClick={() => { setMode("login"); setError(null); setNotice(null); }}>Log in</button></>
        )}
      </p>
    </div>
  );
}
