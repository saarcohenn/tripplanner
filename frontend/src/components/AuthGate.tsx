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

  async function submit(e: React.FormEvent) {
    // The submit event itself is what a password manager watches, so it has to happen — the
    // default navigation is all that's cancelled here.
    e.preventDefault();
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

  function switchTo(next: "login" | "signup") {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  return (
    <div className="pad auth-screen">
      <h1>TripPlanner</h1>
      <h2>{mode === "login" ? "Log in" : "Sign up"}</h2>
      {/*
        A real <form> with a submit button and named, autocomplete-tagged fields. iOS Safari
        only offers to save a password — and only fills one back in, including in an installed
        PWA — when it sees a form submitted with a field that says it is the username and one
        that says it is the password. Buttons that aren't the submit say so explicitly:
        inside a form a bare <button> is a submit button.
      */}
      <form onSubmit={submit}>
        {mode === "signup" && (
          <label className="block">Display name
            <input
              name="name" autoComplete="name" dir="auto"
              value={displayName} onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
        )}
        <label className="block">Email
          <input
            type="email" name="email" autoComplete="username" inputMode="email"
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            value={email} onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block">Password
          <input
            type="password" name="password"
            // Asking for the saved one on the way in, and offering to save a new one on the
            // way up: the same attribute says both, depending on which it is.
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="alert">{error}</div>}
        {notice && <p className="hint">{notice}</p>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Log in" : "Sign up"}
        </button>
      </form>
      <p className="hint">
        {mode === "login" ? (
          <>No account? <button type="button" className="inline" onClick={() => switchTo("signup")}>Sign up</button></>
        ) : (
          <>Already have an account? <button type="button" className="inline" onClick={() => switchTo("login")}>Log in</button></>
        )}
      </p>
    </div>
  );
}
