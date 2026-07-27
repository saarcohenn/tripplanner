import { db } from "./db.js";

export function roomIdsForUser(userId: number): number[] {
  const rows = db.prepare("SELECT room_id FROM room_members WHERE user_id = ?").all(userId) as { room_id: number }[];
  return rows.map((r) => r.room_id);
}

/** Loads a trip, 404ing unless it belongs to a room the user is a member of. */
export function assertTripAccess(userId: number, tripId: number): any {
  const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(tripId) as any;
  if (!trip) throw Object.assign(new Error("Trip not found"), { status: 404 });
  const member = db.prepare("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?").get(trip.room_id, userId);
  if (!member) throw Object.assign(new Error("Trip not found"), { status: 404 });
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
