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
  stage: "collect" | "planned";
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
  google_place_id: string;
  photo_ref: string;
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
  details?: string;
  tip?: string;
  note?: string;
};

export type PlanDay = {
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

export type Settings = {
  llm_provider: string | null;
  llm_api_key: string | null;
  llm_model: string | null;
  auto_replan: string | null;
  google_maps_api_key: string | null;
  google_maps_key_source: "db" | "env" | null;
  llm_price_in: string | null;
  llm_price_out: string | null;
  llm_monthly_budget: string | null;
  default_models: Record<string, string>;
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
