# 🧭 TripPlanner

Self-hosted travel planner that turns **your** chosen places into a realistic day-by-day
schedule — and, unlike every other travel site, **never suggests new places**. Instead it
tells you what to *drop*, when to *rest*, and when you'll have to *wake up early* to make
your own plan work.

## Features

- **Multi-city / multi-country trips** — a trip is an ordered list of legs (city + date range).
  One-way, round-trip and multi-city are all supported.
- **Interactive map** — with a Google Maps API key: Google map tiles with **English labels**,
  English place search, and **place photos** (Places API). Without one it falls back to
  Leaflet + OpenStreetMap with Nominatim search. Either way: click-to-pin, paste a Google Maps
  link, and an "Open in Google Maps" link on every place.
- **Multi-stage trips** — stage 1: collect places; stage 2: generate the plan (trip turns
  **green**); stage 3: adding a place to a planned trip asks for confirmation first, since the
  plan may change.
- **Plan generator** — your configured LLM arranges *only the places you added* into a detailed
  daily travel guide: directions between stops, queue-avoidance tips, meals, transit, rest
  blocks, and a per-day **alarm suggestion** ("Alarm 06:45 — be at Fushimi Inari by 07:30,
  before the tour groups").
- **Expenses** — log spending per city/category, see totals vs. budget with breakdowns;
  booking costs are included automatically.
- **Advisor** — reviews the plan and flags overloaded days, drop candidates, needed rest and
  early wake-ups. It is hard-prompted to never recommend new attractions.
- **Change listener** — any change to legs/places/bookings marks the plan outdated; with
  *Auto-replan* enabled the schedule regenerates itself a few seconds later.
- **Todo lists** with categories and due dates.
- **Bookings** — record flights/stays/trains, plus one-click Booking.com / Airbnb searches
  pre-filled with each city and your leg dates.
- **Conversation import** — paste a planning conversation (Claude / ChatGPT / any language,
  Hebrew included) and the LLM extracts destinations, dates, places, budget and todos into a
  new trip. Nothing is invented.
- **Bring your own LLM** — Anthropic, OpenAI, Google Gemini or OpenRouter. Your API key is
  stored only in the app's own SQLite database on your server.

## Run with Docker (recommended)

```bash
docker compose up -d --build
# open http://localhost:8080
```

Data (trips + settings + your API key) lives in the `tripplanner-data` volume.

The Google Maps key can be provided as an environment variable instead of the Settings UI:
copy `.env.example` to `.env` and set `GOOGLE_MAPS_API_KEY` — docker-compose picks it up
automatically. A key saved in the Settings UI takes precedence over the env var.

### Homelab deployment via GHCR

1. Push this repo to GitHub. The included workflow (`.github/workflows/docker.yml`) builds and
   pushes `ghcr.io/<your-user>/tripplanner:latest` on every push to `main`.
2. Edit `docker-compose.yml` and replace `YOUR_GITHUB_USERNAME` with your GitHub username.
3. On the homelab box:

```bash
docker compose pull && docker compose up -d
```

(If the package is private, `docker login ghcr.io` with a PAT that has `read:packages` first.)

## Local development

```bash
# terminal 1 — API on :8090 (so it can run next to the production container on :8080)
cd backend && npm install && npm run dev

# terminal 2 — Vite dev server on :5173 (proxies /api)
cd frontend && npm install && npm run dev
```

## First-time setup

1. Open **Settings**, pick your provider, paste your API key, **Save**, then **Test connection**.
2. Optionally enable **Auto-replan**.
3. Create a trip (or use **Import** to extract one from a planning conversation).
4. Add legs in **Overview**, add places from the **Map** or **Places** tab.
5. Open **Plan** → **Generate plan**. The Advisor panel appears next to the schedule.

## Architecture

```
frontend/   React + TypeScript + Vite + Leaflet (react-leaflet)
backend/    Node 20+ + Express + better-sqlite3 (single-file DB in ./data or $DATA_DIR)
Dockerfile  multi-stage: builds frontend, compiles backend, single runtime image on :8080
```

The backend proxies all LLM calls server-side (`/api/settings`, `/api/trips/:id/generate-plan`,
`/api/trips/:id/advise`, `/api/import/conversation`), so the API key never reaches the browser —
`GET /api/settings` returns only a masked fingerprint of it.
