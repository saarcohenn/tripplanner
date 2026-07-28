import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Room, RoomMember, Trip, User } from "../types";

function RoomCard({ room, currentUser, trips, reloadTrips }: {
  room: Room; currentUser: User; trips: Trip[]; reloadTrips: () => void;
}) {
  const [members, setMembers] = useState<RoomMember[] | null>(null);
  const [open, setOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<{ id: number; email: string; display_name: string }[]>([]);
  const [showHits, setShowHits] = useState(false);
  const [moveTripId, setMoveTripId] = useState("");
  const [moving, setMoving] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const isOwner = members?.find((m) => m.id === currentUser.id)?.role === "owner";
  const roomTrips = trips.filter((t) => t.room_id === room.id);
  const otherTrips = trips.filter((t) => t.room_id !== room.id);

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
    const q = identifier.trim();
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
  }, [identifier, members]);

  async function invite(pickedUserId?: number) {
    setBusy(true);
    setError(null);
    try {
      if (pickedUserId) {
        await api.post(`/rooms/${room.id}/invite`, { user_id: pickedUserId, role: inviteRole });
      } else {
        const target = identifier.trim();
        if (!target) return;
        await api.post(`/rooms/${room.id}/invite`, { identifier: target, role: inviteRole });
      }
      setIdentifier("");
      setHits([]);
      setShowHits(false);
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: number, role: "editor" | "viewer") {
    await api.put(`/rooms/${room.id}/members/${userId}/role`, { role });
    reload();
  }

  async function removeMember(userId: number) {
    if (!window.confirm("Remove this person from the room? They'll lose access to every trip in it.")) return;
    await api.del(`/rooms/${room.id}/members/${userId}`);
    reload();
  }

  async function moveTripHere() {
    if (!moveTripId) return;
    setMoving(true);
    setError(null);
    try {
      await api.put(`/trips/${moveTripId}/room`, { room_id: room.id });
      setMoveTripId("");
      reloadTrips();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setMoving(false);
    }
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
                  <span dir="auto">{m.display_name || m.email}</span>
                  {m.role === "owner" ? (
                    <span className="hint">owner</span>
                  ) : isOwner ? (
                    <div className="row" style={{ gap: 6 }}>
                      <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value as "editor" | "viewer")}>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button className="danger small" onClick={() => removeMember(m.id)}>Remove</button>
                    </div>
                  ) : (
                    <span className="hint">{m.role}</span>
                  )}
                </div>
              ))}

              {isOwner && (
                <div className="filter-search" ref={wrapRef}>
                  <div className="row">
                    <input
                      placeholder="Invite by email or username…" value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      onFocus={() => hits.length > 0 && setShowHits(true)}
                      onKeyDown={(e) => e.key === "Enter" && invite()}
                    />
                    <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button className="primary" disabled={busy || !identifier.trim()} onClick={() => invite()}>Invite</button>
                  </div>
                  {showHits && hits.length > 0 && (
                    <ul className="autocomplete">
                      {hits.map((h) => (
                        <li key={h.id} onClick={() => invite(h.id)}>
                          <div dir="auto"><strong>{h.display_name || h.email}</strong></div>
                          <div className="hint">{h.email}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <h4 style={{ marginTop: 12 }}>Trips in this room</h4>
              {roomTrips.length === 0 && <p className="hint">No trips here yet.</p>}
              <ul className="leg-list">
                {roomTrips.map((t) => <li key={t.id} dir="auto">{t.name}</li>)}
              </ul>
              {otherTrips.length > 0 && (
                <div className="row">
                  <select value={moveTripId} onChange={(e) => setMoveTripId(e.target.value)}>
                    <option value="">Add one of your trips…</option>
                    {otherTrips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <button className="primary" disabled={moving || !moveTripId} onClick={moveTripHere}>+ Add to room</button>
                </div>
              )}

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
  const [trips, setTrips] = useState<Trip[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const reload = () => api.get<Room[]>("/rooms").then(setRooms).catch(() => {});
  const reloadTrips = () => api.get<Trip[]>("/trips").then(setTrips).catch(() => {});
  useEffect(() => { reload(); reloadTrips(); }, []);

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
        A room holds one or more trips shared with the people you invite. Create/import a trip as usual, then
        use "+ Add to room" below to move it into a shared room — every member sees every trip inside it,
        editors can change things, viewers can only look.
      </p>
      <div className="row">
        <input placeholder="New room name…" value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()} />
        <button className="primary" disabled={creating || !newName.trim()} onClick={create}>+ Create room</button>
      </div>
      <div className="leg-list">
        {(rooms || []).map((r) => (
          <RoomCard key={r.id} room={r} currentUser={currentUser} trips={trips} reloadTrips={reloadTrips} />
        ))}
      </div>
      {rooms && rooms.length === 0 && <p className="hint">No rooms yet.</p>}
    </div>
  );
}
