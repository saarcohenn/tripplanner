import { db } from "./db.js";

export function roomIdsForUser(userId: number): number[] {
  const rows = db.prepare("SELECT room_id FROM room_members WHERE user_id = ?").all(userId) as { room_id: number }[];
  return rows.map((r) => r.room_id);
}

function roomRole(userId: number, roomId: number): string | null {
  const row = db.prepare("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?").get(roomId, userId) as
    | { role: string }
    | undefined;
  return row?.role ?? null;
}

/** Loads a trip, 404ing unless it belongs to a room the user is a member of (any role, including viewer). */
export function assertTripAccess(userId: number, tripId: number): any {
  const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(tripId) as any;
  if (!trip) throw Object.assign(new Error("Trip not found"), { status: 404 });
  if (!roomRole(userId, trip.room_id)) throw Object.assign(new Error("Trip not found"), { status: 404 });
  return trip;
}

/** Like assertTripAccess, but also 403s a viewer — use on any route that mutates the trip or its children. */
export function assertTripWrite(userId: number, tripId: number): any {
  const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(tripId) as any;
  if (!trip) throw Object.assign(new Error("Trip not found"), { status: 404 });
  const role = roomRole(userId, trip.room_id);
  if (!role) throw Object.assign(new Error("Trip not found"), { status: 404 });
  if (role === "viewer") throw Object.assign(new Error("You have view-only access to this trip"), { status: 403 });
  return trip;
}

/** Creates a personal room for a newly-approved user (a no-op if they already have one). */
export function ensurePersonalRoom(userId: number, displayName: string, email: string) {
  const existing = db.prepare("SELECT id FROM rooms WHERE owner_id = ?").get(userId);
  if (existing) return;
  const label = displayName || email;
  const r = db.prepare("INSERT INTO rooms (name, owner_id) VALUES (?, ?)").run(`${label}'s trips`, userId);
  db.prepare("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'owner')").run(r.lastInsertRowid, userId);
}
