export type Trip = {
  id: number;
  name: string;
  trip_type: "oneway" | "round" | "multicity";
  start_date: string | null;
  end_date: string | null;
  home_city: string;
  budget: number | null;
  currency: string;
  notes: string;
  plan_version: number;
  created_at: string;
  updated_at: string;
};

export type Leg = {
  id: number;
  trip_id: number;
  seq: number;
  city: string;
  country: string;
  arrive_date: string | null;
  depart_date: string | null;
  lat: number | null;
  lng: number | null;
  notes: string;
};

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
};

export type Todo = {
  id: number;
  trip_id: number;
  text: string;
  category: string;
  due_date: string | null;
  done: number;
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
};

export type PlanItem = {
  time: string;
  kind: string;
  title: string;
  place_id: number | null;
  duration_min: number;
  note?: string;
};

export type PlanDay = {
  date: string;
  city: string;
  wake_time: string;
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
};

export type TripDetail = {
  trip: Trip;
  legs: Leg[];
  places: Place[];
  bookings: Booking[];
  todos: Todo[];
  plan: PlanRow | null;
};

export type Settings = {
  llm_provider: string | null;
  llm_api_key: string | null;
  llm_model: string | null;
  auto_replan: string | null;
  default_models: Record<string, string>;
};
