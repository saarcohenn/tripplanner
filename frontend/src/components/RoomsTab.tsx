import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Room, RoomMember, User } from "../types";

function RoomCard({ room, currentUser }: { room: Room; currentUser: User }) {
  const [members, setMembers] = useState<RoomMember[] | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<{ id: number; email: string; display_name: string }[]>([]);
  const [showHits, setShowHits] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const isOwner = members?.find((m) => m.id === currentUser.id)?.role === "owner";

  function reload() {
    api.get<RoomMember[]>(`/rooms/${room.id}/members`).then(setMembers).catch(() => {});
  }
  useEffect(() => { if (open) reload(); }, [open]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setShowHits(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const q = email.trim();
    if (q.length < 2) { setHits([]); return; }
    debounceRef.current = window.setTimeout(async () => {
      try {
        const r = await api.get<{ id: number; email: string; display_name: string }[]>(`/users/search?q=${encodeURIComponent(q)}`);
        setHits(r.filter((u) => !members?.some((m) => m.id === u.id)));
        setShowHits(true);
      } catch {
        setHits([]);
      }
    }, 350);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [email, members]);

  async function invite(pickedEmail?: string) {
    const target = (pickedEmail || email).trim();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/rooms/${room.id}/invite`, { email: target });
      setEmail("");
      setHits([]);
      setShowHits(false);
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(userId: number) {
    if (!window.confirm("Remove this person from the room? They'll lose access to every trip in it.")) return;
    await api.del(`/rooms/${room.id}/members/${userId}`);
    reload();
  }

  return (
    <div className="bcard">
      <button className="bcard-head" onClick={() => setOpen((v) => !v)}>
        <span className="bcard-chev">{open ? "▾" : "▸"}</span>
        <span className="grow bcard-title" dir="auto">{room.name}</span>
      </button>
      {open && (
        <div className="bcard-body">
          {!members ? <p className="hint">Loading…</p> : (
            <>
              {members.map((m) => (
                <div className="row spread" key={m.id}>
                  <span dir="auto">{m.display_name || m.email} {m.role === "owner" && <span className="hint">(owner)</span>}</span>
                  {isOwner && m.role !== "owner" && (
                    <button className="danger small" onClick={() => removeMember(m.id)}>Remove</button>
                  )}
                </div>
              ))}
              <div className="filter-search" ref={wrapRef}>
                <div className="row">
                  <input
                    placeholder="Invite by email…" value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => hits.length > 0 && setShowHits(true)}
                    onKeyDown={(e) => e.key === "Enter" && invite()}
                  />
                  <button className="primary" disabled={busy || !email.trim()} onClick={() => invite()}>Invite</button>
                </div>
                {showHits && hits.length > 0 && (
                  <ul className="autocomplete">
                    {hits.map((h) => (
                      <li key={h.id} onClick={() => invite(h.email)}>
                        <div dir="auto"><strong>{h.display_name || h.email}</strong></div>
                        <div className="hint">{h.email}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {error && <p className="hint" style={{ color: "var(--danger, #c93b3b)" }}>{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function RoomsTab({ currentUser }: { currentUser: User }) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const reload = () => api.get<Room[]>("/rooms").then(setRooms).catch(() => {});
  useEffect(() => { reload(); }, []);

  async function create() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.post("/rooms", { name: newName.trim() });
      setNewName("");
      await reload();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="pad narrow">
      <h2>Rooms</h2>
      <p className="hint">
        A room holds one or more trips shared with the people you invite. Every trip lives in exactly one
        room — invite someone to a room and they get access to everything inside it.
      </p>
      <div className="row">
        <input placeholder="New room name…" value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()} />
        <button className="primary" disabled={creating || !newName.trim()} onClick={create}>+ Create room</button>
      </div>
      <div className="leg-list">
        {(rooms || []).map((r) => <RoomCard key={r.id} room={r} currentUser={currentUser} />)}
      </div>
      {rooms && rooms.length === 0 && <p className="hint">No rooms yet.</p>}
    </div>
  );
}
