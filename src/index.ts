// ─── GENESIS TOXICITY ORACLE — WD-036 ───────────────────────────────────────
// VPIN Flow Toxicity Predictor — Volume-clock bucketing + autocorrelation
// Port 8858 | 21 Endpoints | 3 Loops
// Spark #007 v9.2 — GCHQ lens Final Polish (2026-03-30)
// Academic: Easley et al. (2012), Hawkes (1971), Bremaud & Massoulie (1996)
// ─────────────────────────────────────────────────────────────────────────────

import express from "express";
import { VpinEngineService } from "./services/vpin-engine.service";
import { ToxicityClassifierService } from "./services/toxicity-classifier.service";
import { AdvisoryEmitterService } from "./services/advisory-emitter.service";
import { HawkesVpinForecastService } from "./services/hawkes-vpin-forecast.service";
import { BayesianBvcService } from "./services/bayesian-bvc.service";
import { CrossVenueContagionService } from "./services/cross-venue-contagion.service";
import { SpectralRadiusService } from "./services/spectral-radius.service";
import { HealthResponse } from "./types";

const app = express();
app.use(express.json());
const PORT = parseInt(process.env.TOXICITY_ORACLE_PORT || "8858", 10);
const startTime = Date.now();

// ── Service Instantiation ─────────────────────────────────────────────────

const vpinEngine = new VpinEngineService();
const classifier = new ToxicityClassifierService(vpinEngine);
const emitter = new AdvisoryEmitterService();
const hawkesVpin = new HawkesVpinForecastService();
const bayesianBvc = new BayesianBvcService();
const contagion = new CrossVenueContagionService();
const spectral = new SpectralRadiusService();

// ── Loop State ────────────────────────────────────────────────────────────

const loops = [
  { name: "Volume Bucketing", intervalMs: 10_000, lastRun: 0 },
  { name: "Toxicity Classification", intervalMs: 30_000, lastRun: 0 },
  { name: "Advisory Broadcast", intervalMs: 60_000, lastRun: 0 },
];

// ── Loop Functions ────────────────────────────────────────────────────────

async function loopBucket(): Promise<void> {
  const count = await vpinEngine.collectFromFeeds();
  loops[0].lastRun = Date.now();
  if (count > 0) console.log(`[LOOP] Volume bucketing: ${count} trades ingested`);
}

async function loopClassify(): Promise<void> {
  const assessments = classifier.classifyAll();
  loops[1].lastRun = Date.now();
  const toxic = assessments.filter((a) => a.level === "TOXIC").length;
  if (toxic > 0) console.log(`[LOOP] Toxicity classification: ${toxic} TOXIC instruments detected`);
}

async function loopBroadcast(): Promise<void> {
  const assessments = classifier.getCurrentAssessments().filter((a) => a.level !== "CLEAN");
  const adjustments = emitter.generateAdjustments(assessments);
  await emitter.broadcastAdjustments(adjustments);
  loops[2].lastRun = Date.now();
}

// ── Health Endpoints (4) ──────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  const stats = classifier.getStats();
  const advStats = emitter.getStats();
  const response: HealthResponse = {
    service: "GENESIS-TOXICITY-ORACLE",
    version: "9.2.0",
    port: PORT,
    status: stats.toxic > 5 ? "RED" : stats.toxic > 0 ? "YELLOW" : "GREEN",
    uptime: Date.now() - startTime,
    stats: {
      instrumentsTracked: vpinEngine.getInstrumentCount(),
      totalBuckets: vpinEngine.getTotalBuckets(),
      totalAssessments: stats.totalAssessments,
      toxicInstruments: stats.toxic,
      elevatedInstruments: stats.elevated,
      cleanInstruments: stats.clean,
      alertsActive: stats.alertsActive,
      advisoriesEmitted: advStats.totalEmitted,
    },
    loops,
  };
  res.json(response);
});

app.get("/state", (_req, res) => {
  res.json({
    service: "GENESIS-TOXICITY-ORACLE",
    uptime: Date.now() - startTime,
    vpin: { instruments: vpinEngine.getInstrumentCount(), buckets: vpinEngine.getTotalBuckets() },
    toxicity: classifier.getStats(),
    advisory: emitter.getStats(),
    loops,
  });
});

app.get("/stats", (_req, res) => {
  res.json({ ...classifier.getStats(), ...emitter.getStats(), instruments: vpinEngine.getInstrumentCount() });
});

app.post("/reset", (_req, res) => {
  vpinEngine.reset();
  classifier.reset();
  emitter.reset();
  res.json({ reset: true });
});

// ── VPIN Endpoints (4) ───────────────────────────────────────────────────

app.get("/vpin", (_req, res) => {
  res.json({ readings: vpinEngine.getAllVpin() });
});

app.get("/vpin/:instrument", (req, res) => {
  const reading = vpinEngine.getVpin(req.params.instrument);
  if (!reading) return res.status(404).json({ error: "Instrument not tracked" });
  res.json(reading);
});

app.get("/vpin/history", (req, res) => {
  const instrument = req.query.instrument as string || "BTCUSDT";
  res.json({ buckets: vpinEngine.getBuckets(instrument) });
});

app.post("/vpin/snapshot", (_req, res) => {
  res.json({ readings: vpinEngine.getAllVpin(), timestamp: Date.now() });
});

// ── Toxicity Endpoints (4) ───────────────────────────────────────────────

app.get("/toxicity/current", (_req, res) => {
  res.json({ assessments: classifier.getCurrentAssessments() });
});

app.get("/toxicity/alerts", (_req, res) => {
  res.json({ active: classifier.getActiveAlerts(), all: classifier.getAllAlerts() });
});

app.get("/toxicity/:instrument", (req, res) => {
  res.json({ assessments: classifier.getByInstrument(req.params.instrument) });
});

app.post("/toxicity/assess", (_req, res) => {
  const assessments = classifier.classifyAll();
  res.json({ assessed: assessments.length, assessments });
});

// ── Advisory Endpoints (4) ───────────────────────────────────────────────

app.get("/advisory/recent", (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json({ adjustments: emitter.getRecent(limit) });
});

app.get("/advisory/stats", (_req, res) => {
  res.json(emitter.getStats());
});

app.get("/advisory/active", (_req, res) => {
  res.json({ adjustments: emitter.getActive() });
});

app.post("/advisory/manual", async (_req, res) => {
  const assessments = classifier.getCurrentAssessments().filter((a) => a.level !== "CLEAN");
  const adjustments = emitter.generateAdjustments(assessments);
  await emitter.broadcastAdjustments(adjustments);
  res.json({ emitted: adjustments.length, adjustments });
});

// ── Hawkes VPIN Forecast Endpoint (v9.2) ────────────────────────────────

app.get("/vpin/forecast", (_req, res) => {
  const forecasts = hawkesVpin.forecast();
  res.json({ forecasts, state: hawkesVpin.getState() });
});

// ── Bayesian BVC Endpoint (v9.2) ────────────────────────────────────────

app.get("/vpin/bvc", (_req, res) => {
  res.json(bayesianBvc.getState());
});

// ── Cross-Venue Contagion Endpoint (v9.2) ───────────────────────────────

app.get("/contagion/matrix", (_req, res) => {
  res.json(contagion.getState());
});

// ── Spectral Radius Endpoint (v9.2) ────────────────────────────────────

app.get("/contagion/spectral", (_req, res) => {
  const sr = spectral.computeSpectralRadius();
  res.json(spectral.getState());
});

// ── Master v9.2 Dashboard ───────────────────────────────────────────────

app.get("/v92/status", (_req, res) => {
  res.json({
    service: "GENESIS-TOXICITY-ORACLE",
    version: "9.2.0",
    spark: "#007 GCHQ v9.2 Final Polish",
    uptime: Date.now() - startTime,
    hawkesVpin: hawkesVpin.getState(),
    bayesianBvc: bayesianBvc.getState(),
    contagion: contagion.getState(),
    spectral: spectral.getState(),
    vpin: { instruments: vpinEngine.getInstrumentCount(), buckets: vpinEngine.getTotalBuckets() },
    toxicity: classifier.getStats(),
    advisory: emitter.getStats(),
    loops,
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  GENESIS TOXICITY ORACLE — WD-036");
  console.log("  VPIN Flow Toxicity Predictor — v9.2 POLISHED");
  console.log("  Spark #007 — GCHQ lens Final Polish");
  console.log(`  Port: ${PORT}`);
  console.log("  Endpoints: 21 (health 4, vpin 4, toxicity 4, advisory 4, v9.2 5)");
  console.log("  Loops: 3 (bucket 10s, classify 30s, broadcast 60s)");
  console.log("  v9.2: Hawkes VPIN + Bayesian BVC + Contagion + Spectral Radius");
  console.log("  Deployment Class: INTEL, DEFENCE");
  console.log("═══════════════════════════════════════════════════════════");

  setInterval(loopBucket, loops[0].intervalMs);
  setInterval(loopClassify, loops[1].intervalMs);
  setInterval(loopBroadcast, loops[2].intervalMs);

  setTimeout(loopBucket, 3_000);
  setTimeout(loopClassify, 8_000);
  setTimeout(loopBroadcast, 15_000);
});
