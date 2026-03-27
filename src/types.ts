// ─── GENESIS TOXICITY ORACLE — WD-036 Types ─────────────────────────────────
// VPIN Flow Toxicity Predictor — Volume-clock bucketing + autocorrelation
// Spark #007 — GCHQ lens (Grok, 2026-03-26)
// Academic: Easley, López de Prado & O'Hara (2012) — VPIN predicts flash crashes
// ─────────────────────────────────────────────────────────────────────────────

// ── Volume Bucketing ────────────────────────────────────────────────────────

export interface TradeEvent {
  instrument: string;
  price: number;
  volume: number;
  side: "BUY" | "SELL" | "UNKNOWN";
  exchange: string;
  timestamp: number;
}

export interface VolumeBucket {
  bucketId: string;
  instrument: string;
  targetVolume: number;
  actualVolume: number;
  buyVolume: number;
  sellVolume: number;
  orderImbalance: number; // |buyVol - sellVol| / totalVol
  startTime: number;
  endTime: number;
  tradeCount: number;
}

// ── VPIN ────────────────────────────────────────────────────────────────────

export interface VpinReading {
  instrument: string;
  vpin: number; // 0-1, probability of informed trading
  bucketWindow: number; // number of buckets in computation
  buyPressure: number;
  sellPressure: number;
  lastBucketTime: number;
  sampleCount: number;
}

// ── Toxicity Classification ─────────────────────────────────────────────────

export type ToxicityLevel = "CLEAN" | "ELEVATED" | "TOXIC";

export interface QuoteAutocorrelation {
  instrument: string;
  lagMs: number;
  autocorrelation: number; // -1 to 1
  sampleCount: number;
}

export interface ToxicityAssessment {
  assessmentId: string;
  instrument: string;
  level: ToxicityLevel;
  vpin: number;
  autocorrelation: number;
  vpinThreshold: number;
  autocorrelationThreshold: number;
  flashCrashRisk: boolean;
  timestamp: number;
}

export interface ToxicityAlert {
  alertId: string;
  instrument: string;
  level: ToxicityLevel;
  vpin: number;
  autocorrelation: number;
  advisory: string;
  issuedAt: number;
  resolvedAt: number | null;
}

// ── Advisory ────────────────────────────────────────────────────────────────

export type AdvisoryAction = "WIDEN_SPREAD" | "REDUCE_SIZE" | "ROUTE_AWAY" | "HOLD" | "NORMAL";

export interface KellyAdjustment {
  adjustmentId: string;
  instrument: string;
  action: AdvisoryAction;
  toxicityLevel: ToxicityLevel;
  kellyReduction: number; // 0-1, fraction to reduce position sizing
  targetInstruments: string[]; // correlated non-toxic alternatives
  emittedAt: number;
}

// ── Stats ───────────────────────────────────────────────────────────────────

export interface OracleStats {
  instrumentsTracked: number;
  totalBuckets: number;
  totalAssessments: number;
  toxicInstruments: number;
  elevatedInstruments: number;
  cleanInstruments: number;
  alertsActive: number;
  advisoriesEmitted: number;
}

// ── Health ──────────────────────────────────────────────────────────────────

export interface HealthResponse {
  service: string;
  version: string;
  port: number;
  status: "GREEN" | "YELLOW" | "RED";
  uptime: number;
  stats: OracleStats;
  loops: { name: string; intervalMs: number; lastRun: number }[];
}
