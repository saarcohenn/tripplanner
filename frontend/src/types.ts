export type User = {
  id: number;
  email: string;
  display_name: string;
  role: "admin" | "user";
  status: "pending" | "approved" | "rejected";
  created_at: string;
  llm_provider: string | null;
  llm_api_key: string | null;
  llm_model: string | null;
  llm_price_in: string | null;
  llm_price_out: string | null;
  llm_monthly_budget: string | null;
  plan_system_prompt: string | null;
  home_currency: string | null;
  auto_replan: string | null;
};

export type LlmDefaults = {
  default_models: Record<string, string>;
  default_plan_system_prompt: string;
};

export type Room = {
  id: number;
  name: string;
  owner_id: number;
  created_at: string;
};

export type RoomMember = {
  id: number;
  email: string;
  display_name: string;
  role: "owner" | "editor" | "viewer";
};

export type Trip = {
  id: number;
  name: string;
  trip_type: "oneway" | "round" | "multicity";
  start_date: string | null;
  end_date: string | null;
  home_city: string;
  home_airport: string;
  budget: number | null;
  currency: string;
  notes: string;
  plan_version: number;
  stage: "collect" | "planned";
  room_id: number | null;
  room_name: string | null;
  room_owner_id: number | null;
  room_owner_name: string | null;
  room_member_count: number;
  /** The caller's role in this trip's room — a client-side hint; the server checks every write. */
  my_role: "owner" | "editor" | "viewer";
  created_at: string;
  updated_at: string;
};

export type Notification = {
  id: number;
  message: string;
  created_at: string;
  read_at: string | null;
};

export type Leg = {
  id: number;
  trip_id: number;
  seq: number;
  city: string;
  country: string;
  airport: string;
  arrive_date: string | null;
  /** Local "HH:MM" in this leg's own city, or "" when unknown. Never converted. */
  arrive_time: string;
  depart_date: string | null;
  depart_time: string;
  /** How you get around this city. "" means unanswered — never assumed. */
  transport: TransportMode;
  lat: number | null;
  lng: number | null;
  notes: string;
};

export type TransportMode = "" | "transit" | "car" | "walk" | "taxi" | "mixed";

export type Place = {
  id: number;
  trip_id: number;
  leg_id: number | null;
  name: string;
  category: string;
  lat: number | null;
  lng: number | null;
  duration_min: number;
  priority: "must" | "want" | "maybe";
  status: "active" | "dropped";
  notes: string;
  gmaps_url: string;
  google_place_id: string;
  photo_ref: string;
  source: "user" | "ai";
};

export type Expense = {
  id: number;
  trip_id: number;
  leg_id: number | null;
  category: string;
  title: string;
  amount: number;
  currency: string;
  date: string | null;
  notes: string;
};

export type Todo = {
  id: number;
  trip_id: number;
  text: string;
  category: string;
  due_date: string | null;
  done: number;
  source: "user" | "ai";
};

export type Booking = {
  id: number;
  trip_id: number;
  leg_id: number | null;
  kind: string;
  title: string;
  ref: string;
  url: string;
  date: string | null;
  end_date: string | null;
  cost: number | null;
  currency: string;
  notes: string;
  source: "user" | "ai";
};

export type PlanItem = {
  time: string;
  kind: string;
  title: string;
  place_id: number | null;
  duration_min: number;
  details?: string;
  tip?: string;
  note?: string;
  /** Seeded from a booking or a leg's own arrival/departure time — a fixed point the day is built around. */
  pinned?: boolean;
  booking_id?: number | null;
};

export type PlanDay = {
  /**
   * Stable identity, independent of when the day happens. The date used to be the key, which made
   * "this day is now Thursday" a rewrite of every reference to it; with an id the date is just a
   * field and moving a day is a one-line change. Assigned on load for plans written before ids
   * existed — see ensureDayIds.
   */
  id: string;
  date: string;
  city: string;
  wake_time: string;
  alarm_time?: string;
  alarm_reason?: string;
  summary: string;
  items: PlanItem[];
  warnings?: string[];
};

export type PlanDoc = {
  days: PlanDay[];
  unscheduled_place_ids?: number[];
  notes?: string;
};

export type AdvisorDoc = {
  overall: string;
  drop_suggestions: { place_id: number | null; place_name: string; reason: string }[];
  pacing_alerts: { date: string; type: string; message: string }[];
  day_notes: { date: string; note: string }[];
};

export type PlanRow = {
  id: number;
  trip_id: number;
  plan_version: number;
  plan_json: string;
  advisor_json: string | null;
  generated_at: string;
  /** Whether the current document came out of the generator or was built/edited by hand. */
  mode: "llm" | "manual";
  edited_at: string | null;
};

/** The advisor's read on a single day. Capped at three points server-side, not just in the prompt. */
export type DayAdvice = {
  verdict: string;
  load: "" | "light" | "comfortable" | "full" | "too much";
  points: { type: string; message: string }[];
};

export type DayAdviceResult = {
  advice: DayAdvice | null;
  /** The day has been edited since this was written — kept and labelled rather than discarded. */
  stale: boolean;
  generated_at: string | null;
};

/** One turn of the per-day chat. Kept server-side so the thread survives a reload. */
export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

/**
 * A place the chat found for you — from a real Google Places search or a Maps list you gave it,
 * never from the model's own memory. The model can only point at one of these by ref; the server
 * fills in the details from what it actually fetched.
 */
export type ChatFoundPlace = {
  ref: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  google_place_id: string;
  gmaps_url: string;
  /** What produced it: the search text, or the name of the list it came from. */
  via: string;
};

/** What the chat proposes doing to one day. Nothing is written until it's accepted. */
export type ChatProposal = {
  summary: string;
  wake_time: string;
  items: (PlanItem & { new_place_ref?: string | null })[];
  new_places: ChatFoundPlace[];
};

export type ChatTurn = {
  reply: string;
  proposal: ChatProposal | null;
  searched: string[];
  messages: ChatMessage[];
};

/** Background on a single chosen place. Never points anywhere new — see insightPrompt on the server. */
export type PlaceInsight = {
  headline: string;
  history: string;
  fun_fact: string;
  best_time: string;
  tips: string[];
  duration_note: string;
  confidence: "high" | "medium" | "low";
};

export type TripDetail = {
  trip: Trip;
  legs: Leg[];
  places: Place[];
  bookings: Booking[];
  todos: Todo[];
  expenses: Expense[];
  plan: PlanRow | null;
};

/**
 * What the LLM proposes adding to a trip that already exists. Nothing here has been written —
 * every row carries `exists` so the UI can show what the trip already has, and the user ticks
 * what actually lands.
 */
export type ImportProposal = {
  summary: string;
  /** Only fields the trip hasn't got yet — this never proposes replacing something you set. */
  trip: Partial<Pick<Trip, "name" | "trip_type" | "start_date" | "end_date" | "home_city" | "budget" | "currency">>;
  legs: (Partial<Leg> & { city: string; exists: boolean; leg_id: number | null })[];
  places: (Partial<Place> & { name: string; city: string; existing_leg_id: number | null; exists: boolean })[];
  todos: (Partial<Todo> & { text: string; exists: boolean })[];
  bookings: (Partial<Booking> & { title: string; city: string | null; exists: boolean })[];
  notes: string;
};

/** Global admin-only config (Settings tab). Per-user LLM/budget/prompt live on User (Profile tab). */
export type Settings = {
  google_maps_api_key: string | null;
  google_maps_key_source: "db" | "env" | null;
};

/** Same shape, available to every authenticated user (not just admins) via GET /app-config. */
export type AppConfig = {
  google_maps_api_key: string | null;
  google_maps_key_source: "db" | "env" | null;
};

export type PlanJob = {
  id: number;
  trip_id: number;
  kind: "plan" | "advisor";
  status: "running" | "done" | "error";
  error: string | null;
  plan_id: number | null;
  started_at: string;
  finished_at: string | null;
};

export type LlmUsageDay = { day: string; input_tokens: number; output_tokens: number; calls: number };
export type LlmUsageRow = {
  id: number; ts: string; provider: string; model: string; purpose: string;
  input_tokens: number; output_tokens: number;
};
export type ProviderPlan = {
  label: string;
  is_free_tier: boolean;
  key_usage_usd: number;
  key_limit_usd: number | null;
  key_remaining_usd: number | null;
  account_credits_usd: number | null;
  account_usage_usd: number | null;
};

export type LlmUsage = {
  days: LlmUsageDay[];
  month: { input_tokens: number; output_tokens: number; calls: number };
  totals: { input_tokens: number; output_tokens: number; calls: number };
  recent: LlmUsageRow[];
};
