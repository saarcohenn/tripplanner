import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { api } from "./routes.js";

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use("/api", api);
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// In the Docker image the built frontend is copied next to dist/ as public/.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
}

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`TripPlanner API listening on :${port}`));
